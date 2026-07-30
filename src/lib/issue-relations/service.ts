import { randomUUID } from "node:crypto";
import { Prisma, type Issue, type PrismaClient } from "@prisma/client";
import {
  isIssueRelationType,
  type IssueRelationType,
} from "../constants";
import { prisma } from "../prisma";
import { requireCapability } from "../permissions";
import { writeAuditLog } from "../audit";

type Client = PrismaClient | Prisma.TransactionClient;
type Tx = Prisma.TransactionClient;

export class IssueRelationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IssueRelationValidationError";
  }
}

export class IssueRelationNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IssueRelationNotFoundError";
  }
}

export class IssueRelationAccessDeniedError extends Error {
  constructor(message = "您沒有查看或管理治理紀錄關聯的權限。") {
    super(message);
    this.name = "IssueRelationAccessDeniedError";
  }
}

export class IssueRelationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IssueRelationConflictError";
  }
}

const ISSUE_SUMMARY_SELECT = {
  id: true,
  issueKey: true,
  issueType: true,
  changeSubType: true,
  title: true,
  systemName: true,
  workflowStatus: true,
} satisfies Prisma.IssueSelect;

export interface IssueRelationUserSummary {
  id: string;
  name: string;
}

export interface IssueRelationIssueSummary {
  id: string;
  issueKey: string;
  issueType: string;
  changeSubType: string | null;
  title: string;
  systemName: string;
  workflowStatus: string;
}

interface IssueRelationRow {
  id: string;
  sourceIssueId: string;
  targetIssueId: string;
  relationType: string;
  createdById: string;
  createdAt: Date;
  removedById: string | null;
  removedAt: Date | null;
  removalReason: string | null;
}

export interface IssueRelationWithIssues extends IssueRelationRow {
  sourceIssue: IssueRelationIssueSummary;
  targetIssue: IssueRelationIssueSummary;
  createdBy: IssueRelationUserSummary;
  removedBy: IssueRelationUserSummary | null;
}

export interface CreateIssueRelationInput {
  sourceIssueId: string;
  targetIssueId: string;
  relationType: string;
}

export interface RemoveIssueRelationInput {
  relationId: string;
  removalReason: string;
}

export interface RelationQueryOptions {
  includeRemoved?: boolean;
}

export interface RelatedIssueResult {
  direction: "OUTGOING" | "INCOMING";
  relation: IssueRelationWithIssues;
  issue: IssueRelationIssueSummary;
}

interface ExpectedPair {
  sourceType: string;
  targetType: string;
  targetChangeSubType?: string;
}

const EXPECTED_PAIRS: Record<IssueRelationType, ExpectedPair> = {
  INCIDENT_TO_RCA: { sourceType: "Incident", targetType: "RCA" },
  INCIDENT_TO_HOTFIX: { sourceType: "Incident", targetType: "Hotfix" },
  RCA_TO_HOTFIX: { sourceType: "RCA", targetType: "Hotfix" },
  HOTFIX_TO_PROJECT: {
    sourceType: "Hotfix",
    targetType: "ChangeRelease",
    targetChangeSubType: "QUARTERLY_RELEASE",
  },
};

function normalizeId(value: string, label: string): string {
  const id = value.trim();
  if (!id) throw new IssueRelationValidationError(`${label}不可為空。`);
  return id;
}

function parseRelationType(value: string): IssueRelationType {
  if (!isIssueRelationType(value)) {
    throw new IssueRelationValidationError("不支援的治理紀錄關聯類型。");
  }
  return value;
}

function assertIssuePair(
  relationType: IssueRelationType,
  source: Pick<Issue, "issueType" | "changeSubType">,
  target: Pick<Issue, "issueType" | "changeSubType">,
): void {
  const expected = EXPECTED_PAIRS[relationType];
  const targetSubtypeMatches =
    expected.targetChangeSubType === undefined ||
    target.changeSubType === expected.targetChangeSubType;

  if (
    source.issueType !== expected.sourceType ||
    target.issueType !== expected.targetType ||
    !targetSubtypeMatches
  ) {
    throw new IssueRelationValidationError("來源與目標的治理紀錄類型不符合此關聯類型。");
  }
}

async function requireIssueView(actorId: string, client: Client): Promise<void> {
  try {
    await requireCapability({ id: actorId }, "issue.view", client);
  } catch {
    throw new IssueRelationAccessDeniedError();
  }
}

// Issue 領域目前的正式 visibility 是 capability-based global visibility，沒有 row-level
// visibility rule。管理關聯同時要求 issue.view 與 issue.edit；兩者只從 active UserRole
// 解析。這是治理中繼資料權限，絕不執行或繞過 Workflow responsibility。
async function requireIssueRelationManagement(actorId: string, client: Client): Promise<void> {
  try {
    await requireCapability({ id: actorId }, "issue.view", client);
    await requireCapability({ id: actorId }, "issue.edit", client);
  } catch {
    throw new IssueRelationAccessDeniedError();
  }
}

function isPrismaUniqueConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === "P2002" ||
    (candidate.code === "P2010" &&
      typeof candidate.message === "string" &&
      candidate.message.includes("UNIQUE constraint failed"))
  );
}

async function findRelationRow(
  client: Client,
  relationId: string,
  activeOnly = false,
): Promise<IssueRelationRow | null> {
  const rows = await client.$queryRaw<IssueRelationRow[]>(Prisma.sql`
    SELECT
      "id", "sourceIssueId", "targetIssueId", "relationType",
      "createdById", "createdAt", "removedById", "removedAt", "removalReason"
    FROM "IssueRelation"
    WHERE "id" = ${relationId}
      ${activeOnly ? Prisma.sql`AND "removedAt" IS NULL` : Prisma.empty}
    LIMIT 1
  `);
  return rows[0] ?? null;
}

async function hydrateRelation(
  client: Client,
  row: IssueRelationRow,
): Promise<IssueRelationWithIssues> {
  const [sourceIssue, targetIssue, createdBy, removedBy] = await Promise.all([
    client.issue.findUnique({
      where: { id: row.sourceIssueId },
      select: ISSUE_SUMMARY_SELECT,
    }),
    client.issue.findUnique({
      where: { id: row.targetIssueId },
      select: ISSUE_SUMMARY_SELECT,
    }),
    client.user.findUnique({
      where: { id: row.createdById },
      select: { id: true, name: true },
    }),
    row.removedById
      ? client.user.findUnique({
          where: { id: row.removedById },
          select: { id: true, name: true },
        })
      : Promise.resolve(null),
  ]);
  if (!sourceIssue || !targetIssue || !createdBy) {
    throw new IssueRelationNotFoundError("治理紀錄關聯的參照資料不存在。");
  }
  return { ...row, sourceIssue, targetIssue, createdBy, removedBy };
}

export async function createIssueRelationForActor(
  actorId: string,
  input: CreateIssueRelationInput,
): Promise<IssueRelationWithIssues> {
  const sourceIssueId = normalizeId(input.sourceIssueId, "來源工單");
  const targetIssueId = normalizeId(input.targetIssueId, "目標工單");
  const relationType = parseRelationType(input.relationType);

  if (sourceIssueId === targetIssueId) {
    throw new IssueRelationValidationError("治理紀錄不可關聯自己。");
  }

  try {
    return await prisma.$transaction(async (tx) => {
      await requireIssueRelationManagement(actorId, tx);

      const [source, target] = await Promise.all([
        tx.issue.findUnique({
          where: { id: sourceIssueId },
          select: { id: true, issueKey: true, issueType: true, changeSubType: true },
        }),
        tx.issue.findUnique({
          where: { id: targetIssueId },
          select: { id: true, issueKey: true, issueType: true, changeSubType: true },
        }),
      ]);
      if (!source || !target) {
        throw new IssueRelationNotFoundError("找不到來源或目標治理紀錄。");
      }
      assertIssuePair(relationType, source, target);

      const duplicates = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "IssueRelation"
        WHERE "sourceIssueId" = ${sourceIssueId}
          AND "targetIssueId" = ${targetIssueId}
          AND "relationType" = ${relationType}
          AND "removedAt" IS NULL
        LIMIT 1
      `);
      if (duplicates.length > 0) {
        throw new IssueRelationConflictError("相同的有效治理紀錄關聯已存在。");
      }

      if (relationType === "HOTFIX_TO_PROJECT") {
        const currentProjects = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT "id" FROM "IssueRelation"
          WHERE "sourceIssueId" = ${sourceIssueId}
            AND "relationType" = 'HOTFIX_TO_PROJECT'
            AND "removedAt" IS NULL
          LIMIT 1
        `);
        if (currentProjects.length > 0) {
          throw new IssueRelationConflictError("此 Hotfix 已有一個有效的主要季度專案關聯。");
        }
      }

      const relationId = randomUUID();
      const createdAt = new Date();
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "IssueRelation" (
          "id", "sourceIssueId", "targetIssueId", "relationType",
          "createdById", "createdAt"
        ) VALUES (
          ${relationId}, ${sourceIssueId}, ${targetIssueId}, ${relationType},
          ${actorId}, ${createdAt}
        )
      `);
      const relationRow = await findRelationRow(tx, relationId);
      if (!relationRow) throw new IssueRelationNotFoundError("治理紀錄關聯建立失敗。");
      const relation = await hydrateRelation(tx, relationRow);

      await writeAuditLog(
        {
          entityType: "IssueRelation",
          entityId: relation.id,
          actionType: "IssueRelationCreated",
          summary: `建立治理紀錄關聯：${source.issueKey} → ${target.issueKey}`,
          actorUserId: actorId,
          toValue: relationType,
          reasonCode: relationType,
        },
        tx,
      );

      return relation;
    });
  } catch (error) {
    if (isPrismaUniqueConflict(error)) {
      if (relationType === "HOTFIX_TO_PROJECT") {
        throw new IssueRelationConflictError("此 Hotfix 已有一個有效的主要季度專案關聯。");
      }
      throw new IssueRelationConflictError("相同的有效治理紀錄關聯已存在。");
    }
    throw error;
  }
}

export async function removeIssueRelationForActor(
  actorId: string,
  input: RemoveIssueRelationInput,
): Promise<IssueRelationWithIssues> {
  const relationId = normalizeId(input.relationId, "關聯");
  const removalReason = input.removalReason.trim();
  if (!removalReason) {
    throw new IssueRelationValidationError("解除關聯原因為必填。");
  }
  if (removalReason.length > 500) {
    throw new IssueRelationValidationError("解除關聯原因不得超過 500 字。");
  }

  return prisma.$transaction(async (tx) => {
    await requireIssueRelationManagement(actorId, tx);

    const currentRow = await findRelationRow(tx, relationId, true);
    if (!currentRow) {
      throw new IssueRelationNotFoundError("找不到有效的治理紀錄關聯。");
    }
    const current = await hydrateRelation(tx, currentRow);

    // removedAt predicate prevents two concurrent removals from both succeeding.
    const removedAt = new Date();
    const updatedCount = await tx.$executeRaw(Prisma.sql`
      UPDATE "IssueRelation"
      SET
        "removedById" = ${actorId},
        "removedAt" = ${removedAt},
        "removalReason" = ${removalReason}
      WHERE "id" = ${relationId}
        AND "removedAt" IS NULL
    `);
    if (updatedCount !== 1) {
      throw new IssueRelationNotFoundError("此治理紀錄關聯已解除。");
    }

    await writeAuditLog(
      {
        entityType: "IssueRelation",
        entityId: relationId,
        actionType: "IssueRelationRemoved",
        summary: `解除治理紀錄關聯：${current.sourceIssue.issueKey} → ${current.targetIssue.issueKey}`,
        actorUserId: actorId,
        fromValue: current.relationType,
        reasonCode: removalReason,
      },
      tx,
    );

    const removedRow = await findRelationRow(tx, relationId);
    if (!removedRow) throw new IssueRelationNotFoundError("找不到已解除的治理紀錄關聯。");
    return hydrateRelation(tx, removedRow);
  });
}

export async function getDirectIssueRelationsForActor(
  actorId: string,
  issueIdValue: string,
  options: RelationQueryOptions = {},
  client: Client = prisma,
): Promise<IssueRelationWithIssues[]> {
  const issueId = normalizeId(issueIdValue, "工單");
  await requireIssueView(actorId, client);

  const issueExists = await client.issue.findUnique({
    where: { id: issueId },
    select: { id: true },
  });
  if (!issueExists) throw new IssueRelationNotFoundError("找不到此治理紀錄。");

  const rows = await client.$queryRaw<IssueRelationRow[]>(Prisma.sql`
    SELECT
      "id", "sourceIssueId", "targetIssueId", "relationType",
      "createdById", "createdAt", "removedById", "removedAt", "removalReason"
    FROM "IssueRelation"
    WHERE ("sourceIssueId" = ${issueId} OR "targetIssueId" = ${issueId})
      ${options.includeRemoved ? Prisma.empty : Prisma.sql`AND "removedAt" IS NULL`}
    ORDER BY "createdAt" DESC, "id" DESC
  `);
  return Promise.all(rows.map((row) => hydrateRelation(client, row)));
}

export async function getRelatedIssuesByTypeForActor(
  actorId: string,
  issueIdValue: string,
  relationTypeValue: string,
  options: RelationQueryOptions = {},
  client: Client = prisma,
): Promise<RelatedIssueResult[]> {
  const issueId = normalizeId(issueIdValue, "工單");
  const relationType = parseRelationType(relationTypeValue);
  const relations = await getDirectIssueRelationsForActor(actorId, issueId, options, client);

  return relations
    .filter((relation) => relation.relationType === relationType)
    .map((relation) => {
      if (relation.sourceIssueId === issueId) {
        return {
          direction: "OUTGOING" as const,
          relation,
          issue: relation.targetIssue,
        };
      }
      return {
        direction: "INCOMING" as const,
        relation,
        issue: relation.sourceIssue,
      };
    });
}
