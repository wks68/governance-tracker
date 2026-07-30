import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { getUserHasCapability, requireCapability } from "../permissions";
import { formatDate, formatDateTime } from "../datetime";
import { statusLabel } from "../workflow";
import {
  getDirectIssueRelationsForActor,
  IssueRelationAccessDeniedError,
  IssueRelationNotFoundError,
  type IssueRelationWithIssues,
} from "./service";

export interface GovernanceRelationCandidate {
  id: string;
  issueKey: string;
  label: string;
  searchText: string;
}

export interface GovernanceRelationCandidates {
  incidents: GovernanceRelationCandidate[];
  rcas: GovernanceRelationCandidate[];
  hotfixes: GovernanceRelationCandidate[];
  projects: GovernanceRelationCandidate[];
}

export interface GovernanceRelationDisplayItem {
  id: string;
  issueKey: string;
  issueTypeLabel: string;
  title: string;
  systemName: string;
  statusLabel: string;
  createdAt: string | null;
  relationId: string | null;
  pathLabel: string | null;
  isCurrent: boolean;
}

export interface GovernanceRelationGroup {
  key: "incident" | "rca" | "hotfix" | "project";
  label: string;
  items: GovernanceRelationDisplayItem[];
}

export interface GovernanceRelationView {
  issueId: string;
  currentKind: GovernanceRelationGroup["key"];
  canManage: boolean;
  hasRelations: boolean;
  groups: GovernanceRelationGroup[];
  directRelations: Array<{
    relationId: string;
    relatedIssueId: string;
    relatedIssueKey: string;
    relatedTitle: string;
    createdAt: string;
  }>;
  candidates: GovernanceRelationCandidates;
}

export interface GovernanceRelationListSummary {
  incidentCount: number;
  rcaCount: number;
  hotfixCount: number;
  projectIssueKey: string | null;
}

interface RelationRow {
  sourceIssueId: string;
  targetIssueId: string;
  relationType: string;
}

interface IssueForDisplay {
  id: string;
  issueKey: string;
  issueType: string;
  changeSubType: string | null;
  title: string;
  systemName: string;
  workflowStatus: string;
  dueDate: Date | null;
  createdAt: Date;
  closedAt: Date | null;
  currentWorkflowStage: {
    label: string;
    stageKey: string;
    terminalOutcome: string | null;
  } | null;
}

const DISPLAY_ISSUE_INCLUDE = {
  currentWorkflowStage: {
    select: { label: true, stageKey: true, terminalOutcome: true },
  },
} satisfies Prisma.IssueInclude;

function issueKind(
  issue: Pick<IssueForDisplay, "issueType" | "changeSubType">,
): GovernanceRelationGroup["key"] | null {
  if (issue.issueType === "Incident") return "incident";
  if (issue.issueType === "RCA") return "rca";
  if (issue.issueType === "Hotfix") return "hotfix";
  if (
    issue.issueType === "ChangeRelease" &&
    issue.changeSubType === "QUARTERLY_RELEASE"
  ) {
    return "project";
  }
  return null;
}

function issueTypeDisplayLabel(issue: Pick<IssueForDisplay, "issueType" | "changeSubType">): string {
  const kind = issueKind(issue);
  if (kind === "incident") return "事件通報";
  if (kind === "rca") return "RCA";
  if (kind === "hotfix") return "Hotfix";
  if (kind === "project") return "季度專案";
  return "治理紀錄";
}

function businessStatus(issue: IssueForDisplay): string {
  return (
    issue.currentWorkflowStage?.label ??
    statusLabel(issue.issueType, issue.workflowStatus)
  );
}

function isCancelled(issue: IssueForDisplay): boolean {
  return (
    issue.currentWorkflowStage?.terminalOutcome === "CANCELLED" ||
    issue.workflowStatus.toLowerCase() === "cancelled"
  );
}

function isCandidateIssue(issue: IssueForDisplay): boolean {
  const kind = issueKind(issue);
  if (!kind || isCancelled(issue) || issue.currentWorkflowStage?.stageKey === "draft") return false;
  if (kind === "project") {
    return (
      issue.closedAt === null &&
      issue.workflowStatus !== "closed" &&
      issue.currentWorkflowStage?.terminalOutcome !== "COMPLETED"
    );
  }
  return true;
}

function quarterLabel(date: Date | null, fallback: Date): string {
  const value = date ?? fallback;
  return `${value.getUTCFullYear()} Q${Math.floor(value.getUTCMonth() / 3) + 1}`;
}

async function requireView(actorId: string): Promise<void> {
  try {
    await requireCapability({ id: actorId }, "issue.view");
  } catch {
    throw new IssueRelationAccessDeniedError();
  }
}

async function loadActiveRelationRows(): Promise<RelationRow[]> {
  return prisma.$queryRaw<RelationRow[]>(Prisma.sql`
    SELECT "sourceIssueId", "targetIssueId", "relationType"
    FROM "IssueRelation"
    WHERE "removedAt" IS NULL
  `);
}

export async function listGovernanceRelationCandidatesForActor(
  actorId: string,
): Promise<GovernanceRelationCandidates> {
  await requireView(actorId);
  const [issues, relationRows] = await Promise.all([
    prisma.issue.findMany({
      where: {
        OR: [
          { issueType: "Incident" },
          { issueType: "RCA" },
          { issueType: "Hotfix" },
          {
            issueType: "ChangeRelease",
            changeSubType: "QUARTERLY_RELEASE",
          },
        ],
      },
      include: DISPLAY_ISSUE_INCLUDE,
      orderBy: [{ createdAt: "desc" }, { issueKey: "asc" }],
    }),
    loadActiveRelationRows(),
  ]);
  const visible = issues.filter(isCandidateIssue);
  const byId = new Map(visible.map((issue) => [issue.id, issue]));
  const incidentKeysByRca = new Map<string, string[]>();
  for (const row of relationRows) {
    if (row.relationType !== "INCIDENT_TO_RCA") continue;
    const incident = byId.get(row.sourceIssueId);
    if (!incident) continue;
    const keys = incidentKeysByRca.get(row.targetIssueId) ?? [];
    keys.push(incident.issueKey);
    incidentKeysByRca.set(row.targetIssueId, keys);
  }

  const incidents: GovernanceRelationCandidate[] = [];
  const rcas: GovernanceRelationCandidate[] = [];
  const hotfixes: GovernanceRelationCandidate[] = [];
  const projects: GovernanceRelationCandidate[] = [];

  for (const issue of visible) {
    const kind = issueKind(issue);
    if (kind === "incident") {
      const label = [
        issue.issueKey,
        issue.systemName || "—",
        issue.title,
        issue.riskLevel || "未分級",
        formatDate(issue.createdAt),
      ].join("｜");
      incidents.push({ id: issue.id, issueKey: issue.issueKey, label, searchText: label });
    } else if (kind === "rca") {
      const incidentKeys = incidentKeysByRca.get(issue.id) ?? [];
      const label = [
        issue.issueKey,
        issue.systemName || "—",
        incidentKeys.length > 0 ? incidentKeys.join("、") : "尚未關聯事件",
        businessStatus(issue),
      ].join("｜");
      rcas.push({ id: issue.id, issueKey: issue.issueKey, label, searchText: label });
    } else if (kind === "hotfix") {
      const label = [issue.issueKey, issue.systemName || "—", issue.title, businessStatus(issue)].join("｜");
      hotfixes.push({ id: issue.id, issueKey: issue.issueKey, label, searchText: label });
    } else if (kind === "project") {
      const label = [
        issue.issueKey,
        issue.title,
        quarterLabel(issue.dueDate, issue.createdAt),
        issue.systemName || "—",
      ].join("｜");
      projects.push({ id: issue.id, issueKey: issue.issueKey, label, searchText: label });
    }
  }
  return { incidents, rcas, hotfixes, projects };
}

function otherIssue(
  relation: IssueRelationWithIssues,
  issueId: string,
): IssueRelationWithIssues["sourceIssue"] {
  return relation.sourceIssueId === issueId
    ? relation.targetIssue
    : relation.sourceIssue;
}

function relationIssueId(
  relation: IssueRelationWithIssues,
  issueId: string,
): string {
  return otherIssue(relation, issueId).id;
}

async function loadDisplayIssues(ids: readonly string[]): Promise<Map<string, IssueForDisplay>> {
  if (ids.length === 0) return new Map();
  const issues = await prisma.issue.findMany({
    where: { id: { in: [...new Set(ids)] } },
    include: DISPLAY_ISSUE_INCLUDE,
  });
  return new Map(issues.map((issue) => [issue.id, issue]));
}

interface PendingDisplay {
  issueId: string;
  relationId: string | null;
  createdAt: Date | null;
  pathLabel: string | null;
  isCurrent?: boolean;
}

function addPreferred(
  map: Map<string, PendingDisplay>,
  candidate: PendingDisplay,
): void {
  const existing = map.get(candidate.issueId);
  if (!existing || (existing.pathLabel !== null && candidate.pathLabel === null)) {
    map.set(candidate.issueId, candidate);
  }
}

async function relationsForHotfixes(
  actorId: string,
  hotfixIds: readonly string[],
): Promise<Map<string, IssueRelationWithIssues[]>> {
  const entries = await Promise.all(
    [...new Set(hotfixIds)].map(async (hotfixId) => [
      hotfixId,
      await getDirectIssueRelationsForActor(actorId, hotfixId),
    ] as const),
  );
  return new Map(entries);
}

export async function loadGovernanceRelationViewForActor(
  actorId: string,
  issueId: string,
): Promise<GovernanceRelationView> {
  await requireView(actorId);
  const current = await prisma.issue.findUnique({
    where: { id: issueId },
    include: DISPLAY_ISSUE_INCLUDE,
  });
  const currentKind = current ? issueKind(current) : null;
  if (!current || currentKind === null) {
    throw new IssueRelationNotFoundError("此工單不屬於可管理關聯的治理紀錄類型。");
  }

  const direct = await getDirectIssueRelationsForActor(actorId, issueId);
  const pending = new Map<string, PendingDisplay>();
  addPreferred(pending, {
    issueId,
    relationId: null,
    createdAt: null,
    pathLabel: null,
    isCurrent: true,
  });
  for (const relation of direct) {
    addPreferred(pending, {
      issueId: relationIssueId(relation, issueId),
      relationId: relation.id,
      createdAt: relation.createdAt,
      pathLabel: null,
    });
  }

  const directRelated = direct.map((relation) => otherIssue(relation, issueId));
  const directHotfixIds = directRelated
    .filter((issue) => issue.issueType === "Hotfix")
    .map((issue) => issue.id);

  if (currentKind === "incident" || currentKind === "rca") {
    const hotfixRelations = await relationsForHotfixes(actorId, directHotfixIds);
    for (const hotfixId of directHotfixIds) {
      for (const relation of hotfixRelations.get(hotfixId) ?? []) {
        if (relation.relationType !== "HOTFIX_TO_PROJECT" || relation.sourceIssueId !== hotfixId) continue;
        addPreferred(pending, {
          issueId: relation.targetIssueId,
          relationId: null,
          createdAt: relation.createdAt,
          pathLabel: `透過 Hotfix ${relation.sourceIssue.issueKey}`,
        });
      }
    }
  } else if (currentKind === "project") {
    const hotfixRelations = await relationsForHotfixes(actorId, directHotfixIds);
    for (const hotfixId of directHotfixIds) {
      const hotfix = directRelated.find((issue) => issue.id === hotfixId);
      for (const relation of hotfixRelations.get(hotfixId) ?? []) {
        if (
          relation.relationType !== "INCIDENT_TO_HOTFIX" &&
          relation.relationType !== "RCA_TO_HOTFIX"
        ) continue;
        const relatedId = relation.sourceIssueId;
        addPreferred(pending, {
          issueId: relatedId,
          relationId: null,
          createdAt: relation.createdAt,
          pathLabel: `透過 Hotfix ${hotfix?.issueKey ?? ""}`.trim(),
        });
        if (relation.relationType === "RCA_TO_HOTFIX") {
          const rcaRelations = await getDirectIssueRelationsForActor(actorId, relatedId);
          for (const rcaRelation of rcaRelations) {
            if (rcaRelation.relationType !== "INCIDENT_TO_RCA" || rcaRelation.targetIssueId !== relatedId) continue;
            addPreferred(pending, {
              issueId: rcaRelation.sourceIssueId,
              relationId: null,
              createdAt: rcaRelation.createdAt,
              pathLabel: `透過 Hotfix ${hotfix?.issueKey ?? ""}`.trim(),
            });
          }
        }
      }
    }
  }

  const issueMap = await loadDisplayIssues([...pending.keys()]);
  const groupMaps: Record<GovernanceRelationGroup["key"], GovernanceRelationDisplayItem[]> = {
    incident: [],
    rca: [],
    hotfix: [],
    project: [],
  };
  for (const entry of pending.values()) {
    const issue = issueMap.get(entry.issueId);
    if (!issue) continue;
    const kind = issueKind(issue);
    if (!kind) continue;
    groupMaps[kind].push({
      id: issue.id,
      issueKey: issue.issueKey,
      issueTypeLabel: issueTypeDisplayLabel(issue),
      title: issue.title,
      systemName: issue.systemName || "—",
      statusLabel: businessStatus(issue),
      createdAt: entry.createdAt ? formatDateTime(entry.createdAt) : null,
      relationId: entry.relationId,
      pathLabel: entry.pathLabel,
      isCurrent: entry.isCurrent === true,
    });
  }

  const groups: GovernanceRelationGroup[] = [
    { key: "incident", label: "事件通報", items: groupMaps.incident },
    { key: "rca", label: "RCA", items: groupMaps.rca },
    { key: "hotfix", label: "Hotfix", items: groupMaps.hotfix },
    { key: "project", label: "季度專案", items: groupMaps.project },
  ];
  const candidates = await listGovernanceRelationCandidatesForActor(actorId);
  const canManage = await getUserHasCapability({ id: actorId }, "issue.edit");
  return {
    issueId,
    currentKind,
    canManage,
    hasRelations: direct.length > 0,
    groups,
    directRelations: direct.map((relation) => {
      const related = otherIssue(relation, issueId);
      return {
        relationId: relation.id,
        relatedIssueId: related.id,
        relatedIssueKey: related.issueKey,
        relatedTitle: related.title,
        createdAt: formatDateTime(relation.createdAt),
      };
    }),
    candidates,
  };
}

export async function loadGovernanceRelationListSummariesForActor(
  actorId: string,
  issueIds: readonly string[],
): Promise<Map<string, GovernanceRelationListSummary>> {
  await requireView(actorId);
  const uniqueIds = [...new Set(issueIds)];
  const result = new Map<string, GovernanceRelationListSummary>(
    uniqueIds.map((id) => [
      id,
      {
        incidentCount: 0,
        rcaCount: 0,
        hotfixCount: 0,
        projectIssueKey: null,
      },
    ]),
  );
  if (uniqueIds.length === 0) return result;

  const [relations, issues] = await Promise.all([
    loadActiveRelationRows(),
    prisma.issue.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, issueType: true, changeSubType: true },
    }),
  ]);
  const targetIds = relations
    .filter((row) => uniqueIds.includes(row.sourceIssueId) || uniqueIds.includes(row.targetIssueId))
    .flatMap((row) => [row.sourceIssueId, row.targetIssueId]);
  const relatedIssues = await prisma.issue.findMany({
    where: { id: { in: [...new Set(targetIds)] } },
    select: { id: true, issueKey: true },
  });
  const issueKeyById = new Map(relatedIssues.map((issue) => [issue.id, issue.issueKey]));
  const kindById = new Map(issues.map((issue) => [issue.id, issueKind(issue as IssueForDisplay)]));

  for (const relation of relations) {
    const sourceSummary = result.get(relation.sourceIssueId);
    const targetSummary = result.get(relation.targetIssueId);
    if (relation.relationType === "INCIDENT_TO_RCA") {
      if (sourceSummary) sourceSummary.rcaCount += 1;
      if (targetSummary) targetSummary.incidentCount += 1;
    } else if (relation.relationType === "INCIDENT_TO_HOTFIX") {
      if (sourceSummary) sourceSummary.hotfixCount += 1;
      if (targetSummary) targetSummary.incidentCount += 1;
    } else if (relation.relationType === "RCA_TO_HOTFIX") {
      if (sourceSummary) sourceSummary.hotfixCount += 1;
      if (targetSummary) targetSummary.rcaCount += 1;
    } else if (relation.relationType === "HOTFIX_TO_PROJECT") {
      if (sourceSummary) sourceSummary.projectIssueKey = issueKeyById.get(relation.targetIssueId) ?? null;
      if (targetSummary) targetSummary.hotfixCount += 1;
    }
  }

  // Defensive: non-governance rows should never receive relation badges even if a caller
  // accidentally includes them in the list query.
  for (const [id, summary] of result) {
    if (kindById.get(id) === null) result.delete(id);
    else result.set(id, summary);
  }
  return result;
}
