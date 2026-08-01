import "./lib/assertSafeTestDatabase";

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import {
  createIssueRelationBetweenIssuesForActor,
  createIssueRelationForActor,
  getDirectIssueRelationsForActor,
  IssueRelationAccessDeniedError,
  IssueRelationConflictError,
  IssueRelationValidationError,
  removeIssueRelationForActor,
} from "../src/lib/issue-relations/service";
import {
  listGovernanceRelationCandidatesForActor,
  loadGovernanceRelationListSummariesForActor,
  loadGovernanceRelationViewForActor,
} from "../src/lib/issue-relations/viewService";
import {
  createIssueForActor,
  IssueCreationValidationError,
} from "../src/lib/issueCreation";

const FORMAL_DEV_DB = "/workspaces/governance-tracker/prisma/dev.db";
const FORMAL_DEV_DB_SHA256 =
  "3d66755322dc8b67d95edf64a92b134e37282f3521e050430ccb03d84204a181";
const ORIGINAL_PREVIEW_DB =
  "/workspaces/dms-governance-tracker-hotfix-ui/prisma/hotfix-ui-preview.db";
const ORIGINAL_PREVIEW_SHA256 =
  "489ade0c49619e86ac6b1f231a0632512c0adbfda679270e2aab52eb15bcdf9b";

let passed = 0;
let failed = 0;

function hash(path: string): string | null {
  return fs.existsSync(path)
    ? crypto.createHash("sha256").update(fs.readFileSync(path)).digest("hex")
    : null;
}

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? `（${detail}）` : ""}`);
  }
}

async function expectError(
  name: string,
  ErrorType: new (...args: never[]) => Error,
  operation: () => Promise<unknown>,
): Promise<void> {
  try {
    await operation();
    check(name, false, "未拒絕");
  } catch (error) {
    check(
      name,
      error instanceof ErrorType,
      error instanceof Error ? error.name : String(error),
    );
  }
}

async function createGovernanceIssue(input: {
  issueKey: string;
  issueType: string;
  title: string;
  actorId: string;
  workflowStatus: string;
  changeSubType?: string;
  closedAt?: Date;
}) {
  return prisma.issue.create({
    data: {
      issueKey: input.issueKey,
      issueType: input.issueType,
      changeSubType: input.changeSubType,
      title: input.title,
      description: "governance relation UI isolated verify",
      systemName: "MyDMS",
      environment: "Production",
      riskLevel: "低",
      priority: "P3",
      reporter: "Governance UI Verify",
      reporterUserId: input.actorId,
      ownerName: "Governance UI Verify",
      ownerUserId: input.actorId,
      workflowStatus: input.workflowStatus,
      waitingRole: "verify",
      nextStep: "verify",
      closedAt: input.closedAt,
    },
  });
}

function hotfixForm(input: {
  teamId: string;
  applicantId: string;
  title: string;
  incidentIds?: string[];
  rcaIds?: string[];
  projectId?: string;
  relateProject?: boolean;
}): FormData {
  const form = new FormData();
  form.set("issueType", "Hotfix");
  form.set("title", input.title);
  form.set("description", "正式環境治理紀錄關聯交易驗證");
  form.set("systemName", "MyDMS");
  form.set("environment", "Production");
  form.set("riskLevel", "低");
  form.set("priority", "P3");
  form.set("hotfixPriority", "HIGH");
  form.set("dueDate", "2026-12-31");
  form.set("teamId", input.teamId);
  form.set("applicantId", input.applicantId);
  form.set("relateIncidents", input.incidentIds?.length ? "yes" : "no");
  form.set("relateRcas", input.rcaIds?.length ? "yes" : "no");
  form.set("relateProject", input.relateProject || input.projectId ? "yes" : "no");
  for (const id of input.incidentIds ?? []) {
    form.append("incidentRelationIds", id);
  }
  for (const id of input.rcaIds ?? []) {
    form.append("rcaRelationIds", id);
  }
  if (input.projectId) form.set("projectRelationId", input.projectId);
  return form;
}

function groupIds(
  view: Awaited<ReturnType<typeof loadGovernanceRelationViewForActor>>,
  key: "incident" | "rca" | "hotfix" | "project",
): string[] {
  return view.groups.find((group) => group.key === key)?.items.map((item) => item.id) ?? [];
}

async function main(): Promise<void> {
  console.log("=== Governance relationship management UI targeted verify ===");
  const formalBefore = hash(FORMAL_DEV_DB);
  const previewBefore = hash(ORIGINAL_PREVIEW_DB);

  // Governance Preview 目前刻意保留兩個 published Hotfix versions 作展示；正式建立服務
  // 在候選不唯一時會安全地不 auto-start。此測試要驗證「建立 + Workflow + 關聯」原子性，
  // 因此只在隔離副本封存較舊候選，建立唯一且可預期的 auto-start 前置條件。
  const publishedHotfixVersions = await prisma.workflowVersion.findMany({
    where: { status: "PUBLISHED", workflowDefinition: { issueType: "Hotfix" } },
    orderBy: [{ publishedAt: "desc" }, { versionNo: "desc" }],
    select: { id: true },
  });
  if (publishedHotfixVersions.length > 1) {
    await prisma.workflowVersion.updateMany({
      where: { id: { in: publishedHotfixVersions.slice(1).map((version) => version.id) } },
      data: { status: "ARCHIVED" },
    });
  }

  const admin = await prisma.user.findFirstOrThrow({
    where: { email: "admin@formal-org.example.invalid", isActive: true },
  });
  const ken = await prisma.user.findFirstOrThrow({
    where: { email: "ken@formal-org.example.invalid", isActive: true },
  });
  const kenMembership = await prisma.teamMember.findFirstOrThrow({
    where: { userId: ken.id, isActive: true },
    select: { teamId: true },
  });

  const noAccess = await prisma.user.create({
    data: {
      name: "Relation UI no access",
      email: "relation-ui-no-access@verify.invalid",
      department: "Verify",
      role: "Admin",
    },
  });
  await prisma.userRole.create({
    data: { userId: noAccess.id, role: "UNKNOWN_RELATION_ROLE", isActive: true },
  });

  const [incident, incident2, rca, project, project2, cancelledIncident, closedProject] =
    await Promise.all([
      createGovernanceIssue({
        issueKey: "INC-RELUI-0001",
        issueType: "Incident",
        title: "正式事件通報",
        actorId: admin.id,
        workflowStatus: "reported",
      }),
      createGovernanceIssue({
        issueKey: "INC-RELUI-0002",
        issueType: "Incident",
        title: "第二筆正式事件通報",
        actorId: admin.id,
        workflowStatus: "reported",
      }),
      createGovernanceIssue({
        issueKey: "RCA-RELUI-0001",
        issueType: "RCA",
        title: "正式 RCA",
        actorId: admin.id,
        workflowStatus: "created",
      }),
      createGovernanceIssue({
        issueKey: "CHG-RELUI-0001",
        issueType: "ChangeRelease",
        changeSubType: "QUARTERLY_RELEASE",
        title: "2026 Q4 治理專案",
        actorId: admin.id,
        workflowStatus: "created",
      }),
      createGovernanceIssue({
        issueKey: "CHG-RELUI-0002",
        issueType: "ChangeRelease",
        changeSubType: "QUARTERLY_RELEASE",
        title: "2027 Q1 治理專案",
        actorId: admin.id,
        workflowStatus: "created",
      }),
      createGovernanceIssue({
        issueKey: "INC-RELUI-CANCELLED",
        issueType: "Incident",
        title: "已作廢事件",
        actorId: admin.id,
        workflowStatus: "cancelled",
      }),
      createGovernanceIssue({
        issueKey: "CHG-RELUI-CLOSED",
        issueType: "ChangeRelease",
        changeSubType: "QUARTERLY_RELEASE",
        title: "已結案季度專案",
        actorId: admin.id,
        workflowStatus: "closed",
        closedAt: new Date(),
      }),
    ]);

  await createIssueRelationForActor(admin.id, {
    sourceIssueId: incident.id,
    targetIssueId: rca.id,
    relationType: "INCIDENT_TO_RCA",
  });

  const candidates = await listGovernanceRelationCandidatesForActor(admin.id);
  check(
    "[1] Hotfix 建立頁三類候選資料可載入",
    candidates.incidents.some((item) => item.id === incident.id) &&
      candidates.rcas.some((item) => item.id === rca.id) &&
      candidates.projects.some((item) => item.id === project.id),
  );

  const createFieldsSource = fs.readFileSync(
    "src/components/issue-relations/HotfixGovernanceRelationFields.tsx",
    "utf8",
  );
  check(
    "[2] 事件／RCA 使用 checkbox 多選，專案使用單一 select",
    createFieldsSource.includes('type="checkbox"') &&
      createFieldsSource.includes('name="projectRelationId"') &&
      createFieldsSource.includes("<select"),
  );
  check(
    "[3] 切回否會清除尚未提交的三類選擇",
    createFieldsSource.includes("setIncidentIds(new Set())") &&
      createFieldsSource.includes("setRcaIds(new Set())") &&
      createFieldsSource.includes('setProjectId("")'),
  );
  check(
    "[4] 候選資料排除取消紀錄、已結案專案與既有 draft Hotfix",
    !candidates.incidents.some((item) => item.id === cancelledIncident.id) &&
      !candidates.projects.some((item) => item.id === closedProject.id) &&
      !candidates.hotfixes.some((item) => item.issueKey === "HOTFIX-0005"),
  );
  await expectError(
    "[4b] 無 issue.view 的 active UserRole 無法載入候選資料",
    IssueRelationAccessDeniedError,
    () => listGovernanceRelationCandidatesForActor(noAccess.id),
  );

  const missingProjectTitle = "RELUI missing required project";
  await expectError(
    "[5] 選是但未選專案時 Server 拒絕建立",
    IssueCreationValidationError,
    () =>
      createIssueForActor(
        admin,
        hotfixForm({
          teamId: kenMembership.teamId,
          applicantId: ken.id,
          title: missingProjectTitle,
          relateProject: true,
        }),
      ),
  );
  check(
    "[5b] 未選專案不留下部分 Hotfix",
    (await prisma.issue.count({ where: { title: missingProjectTitle } })) === 0,
  );

  const created = await createIssueForActor(
    admin,
    hotfixForm({
      teamId: kenMembership.teamId,
      applicantId: ken.id,
      title: "RELUI atomic Hotfix",
      incidentIds: [incident.id],
      rcaIds: [rca.id],
      projectId: project.id,
    }),
  );
  const createdRelations = await getDirectIssueRelationsForActor(admin.id, created.id);
  check(
    "[6] Hotfix、Workflow 與三類 IssueRelation 在同一建立交易完成",
    created.workflowVersionId !== null &&
      created.currentWorkflowStageId !== null &&
      createdRelations.length === 3 &&
      new Set(createdRelations.map((item) => item.relationType)).size === 3,
  );

  const forgedTitle = "RELUI forged project rollback";
  await expectError(
    "[7] 偽造錯誤類型 ID 時關聯驗證失敗",
    IssueRelationValidationError,
    () =>
      createIssueForActor(
        admin,
        hotfixForm({
          teamId: kenMembership.teamId,
          applicantId: ken.id,
          title: forgedTitle,
          projectId: rca.id,
        }),
      ),
  );
  check(
    "[7b] 關聯失敗時整張 Hotfix 與 Workflow 不會部分建立",
    (await prisma.issue.count({ where: { title: forgedTitle } })) === 0,
  );

  const workflowBefore = await prisma.issue.findUniqueOrThrow({
    where: { id: created.id },
    select: {
      workflowStatus: true,
      workflowVersionId: true,
      currentWorkflowStageId: true,
      assignedTeamId: true,
      ownerUserId: true,
    },
  });
  const added = await createIssueRelationBetweenIssuesForActor(
    admin.id,
    created.id,
    incident2.id,
  );
  await expectError(
    "[8a] 建立後新增相同 active 關聯會被拒絕",
    IssueRelationConflictError,
    () =>
      createIssueRelationBetweenIssuesForActor(
        admin.id,
        created.id,
        incident2.id,
      ),
  );
  await expectError(
    "[8b] Hotfix 已有主要專案時不可再新增第二個",
    IssueRelationConflictError,
    () =>
      createIssueRelationBetweenIssuesForActor(
        admin.id,
        created.id,
        project2.id,
      ),
  );
  await expectError(
    "[9] 解除原因必填",
    IssueRelationValidationError,
    () =>
      removeIssueRelationForActor(admin.id, {
        relationId: added.id,
        removalReason: " ",
      }),
  );
  const removed = await removeIssueRelationForActor(admin.id, {
    relationId: added.id,
    removalReason: "隔離 UI 驗證完成",
  });
  check(
    "[8c] 建立後可解除且舊列保留 soft removal",
    removed.removedAt instanceof Date &&
      removed.removedById === admin.id &&
      removed.removalReason === "隔離 UI 驗證完成",
  );

  const [incidentView, rcaView, hotfixView, projectView] = await Promise.all([
    loadGovernanceRelationViewForActor(admin.id, incident.id),
    loadGovernanceRelationViewForActor(admin.id, rca.id),
    loadGovernanceRelationViewForActor(admin.id, created.id),
    loadGovernanceRelationViewForActor(admin.id, project.id),
  ]);
  check(
    "[10] 四類詳情頁均可雙向顯示直接關聯",
    groupIds(incidentView, "rca").includes(rca.id) &&
      groupIds(incidentView, "hotfix").includes(created.id) &&
      groupIds(rcaView, "incident").includes(incident.id) &&
      groupIds(rcaView, "hotfix").includes(created.id) &&
      groupIds(hotfixView, "incident").includes(incident.id) &&
      groupIds(hotfixView, "rca").includes(rca.id) &&
      groupIds(hotfixView, "project").includes(project.id) &&
      groupIds(projectView, "hotfix").includes(created.id),
  );
  check(
    "[11] 事件／RCA／專案詳情的間接關聯標示透過 Hotfix",
    incidentView.groups
      .flatMap((group) => group.items)
      .some((item) => item.id === project.id && item.pathLabel?.includes("透過 Hotfix")) &&
      rcaView.groups
        .flatMap((group) => group.items)
        .some((item) => item.id === project.id && item.pathLabel?.includes("透過 Hotfix")) &&
      projectView.groups
        .flatMap((group) => group.items)
        .some((item) => item.id === incident.id && item.pathLabel?.includes("透過 Hotfix")),
  );

  const history = await getDirectIssueRelationsForActor(
    admin.id,
    incident2.id,
    { includeRemoved: true },
  );
  check(
    "[12] 同一 active 關聯無重複且解除歷史仍可查詢",
    history.length === 1 && history[0].removedAt !== null,
  );
  check(
    "[13] Hotfix 主要專案仍只有一筆 active 關聯",
    createdRelations.filter(
      (relation) => relation.relationType === "HOTFIX_TO_PROJECT",
    ).length === 1,
  );

  const workflowAfter = await prisma.issue.findUniqueOrThrow({
    where: { id: created.id },
    select: {
      workflowStatus: true,
      workflowVersionId: true,
      currentWorkflowStageId: true,
      assignedTeamId: true,
      ownerUserId: true,
    },
  });
  check(
    "[14] 建立與解除關聯未改變 Workflow、指派或工單狀態",
    JSON.stringify(workflowAfter) === JSON.stringify(workflowBefore),
  );

  const summaries = await loadGovernanceRelationListSummariesForActor(admin.id, [
    incident.id,
    rca.id,
    created.id,
    project.id,
  ]);
  const listPageSource = fs.readFileSync("src/app/issues/page.tsx", "utf8");
  const navSource = fs.readFileSync("src/components/app-shell/AppShell.tsx", "utf8");
  check(
    "[15] 四類清單維持獨立且精簡摘要件數正確",
    listPageSource.includes("Hotfix") &&
      listPageSource.includes("季度專案") &&
      !listPageSource.includes('label: "事件通報"') &&
      !listPageSource.includes('label: "RCA"') &&
      fs.existsSync("src/app/incidents/page.tsx") &&
      fs.existsSync("src/app/rca/page.tsx") &&
      navSource.includes('href: "/incidents"') &&
      navSource.includes('href: "/rca"') &&
      summaries.get(created.id)?.incidentCount === 1 &&
      summaries.get(created.id)?.rcaCount === 1 &&
      summaries.get(created.id)?.projectIssueKey === project.issueKey &&
      summaries.get(project.id)?.hotfixCount === 1,
  );

  const relationAuditCount = await prisma.auditLog.count({
    where: {
      entityType: "IssueRelation",
      actorUserId: admin.id,
    },
  });
  const fakeRelationFields = await prisma.issueFieldValue.count({
    where: {
      issueId: created.id,
      OR: [
        { fieldKey: { contains: "Relation" } },
        { fieldKey: { contains: "relation" } },
      ],
    },
  });
  check(
    "[16] 關聯只寫入 IssueRelation／AuditLog，未用自由欄位模擬",
    relationAuditCount >= 6 && fakeRelationFields === 0,
  );
  check(
    "[17] scratch 副本保留 HOTFIX-0012",
    (await prisma.issue.count({ where: { issueKey: "HOTFIX-0012" } })) === 1,
  );
  check(
    "[18] 正式 dev.db SHA-256 不變",
    formalBefore === FORMAL_DEV_DB_SHA256 &&
      hash(FORMAL_DEV_DB) === FORMAL_DEV_DB_SHA256,
  );
  check(
    "[19] 原 Preview DB SHA-256 不變",
    previewBefore === ORIGINAL_PREVIEW_SHA256 &&
      hash(ORIGINAL_PREVIEW_DB) === ORIGINAL_PREVIEW_SHA256,
  );

  await prisma.$disconnect();
  console.log(`\n結果：PASS ${passed} / FAIL ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
