import "./lib/assertSafeTestDatabase";

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import {
  createIssueRelationForActor,
  getDirectIssueRelationsForActor,
  getRelatedIssuesByTypeForActor,
  IssueRelationAccessDeniedError,
  IssueRelationConflictError,
  IssueRelationValidationError,
  removeIssueRelationForActor,
} from "../src/lib/issue-relations/service";

const FORMAL_DEV_DB = "/workspaces/governance-tracker/prisma/dev.db";
const FORMAL_DEV_DB_SHA256 =
  "3d66755322dc8b67d95edf64a92b134e37282f3521e050430ccb03d84204a181";
const PREVIEW_DB =
  "/workspaces/dms-governance-tracker-hotfix-ui/prisma/hotfix-ui-preview.db";
const PREVIEW_DB_SHA256 =
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

async function expectError<T extends Error>(
  name: string,
  expected: new (...args: never[]) => T,
  operation: () => Promise<unknown>,
): Promise<void> {
  try {
    await operation();
    check(name, false, "未拒絕");
  } catch (error) {
    check(name, error instanceof expected, error instanceof Error ? error.name : String(error));
  }
}

async function createIssue(
  issueKey: string,
  issueType: string,
  reporterUserId: string,
  changeSubType: string | null = null,
) {
  return prisma.issue.create({
    data: {
      issueKey,
      issueType,
      changeSubType,
      title: `${issueKey} verify`,
      systemName: "MyDMS",
      workflowStatus: "隔離測試中",
      reporter: "Relation Manager",
      reporterUserId,
      ownerName: "Relation Manager",
      ownerUserId: reporterUserId,
      waitingRole: "verify",
      nextStep: "verify",
    },
  });
}

async function main(): Promise<void> {
  console.log("=== Typed governance IssueRelation scratch verify ===");

  const formalHashBefore = hash(FORMAL_DEV_DB);
  const previewHashBefore = hash(PREVIEW_DB);

  const manager = await prisma.user.create({
    data: {
      name: "Relation Manager",
      email: "relation-manager@verify.invalid",
      department: "Governance",
      role: "PM",
    },
  });
  await prisma.userRole.create({
    data: { userId: manager.id, role: "PM", isActive: true },
  });

  // User.role deliberately says Admin, but active UserRole only grants read-only governance
  // visibility. This proves that the relation service does not authorize from User.role.
  const viewerOnly = await prisma.user.create({
    data: {
      name: "Viewer Only",
      email: "viewer-only@verify.invalid",
      department: "Governance",
      role: "Admin",
    },
  });
  await prisma.userRole.create({
    data: {
      userId: viewerOnly.id,
      role: "資安推動小組",
      isActive: true,
    },
  });

  const [incident, incident2, rca, hotfix, project1, project2] = await Promise.all([
    createIssue("INC-VERIFY-0001", "Incident", manager.id),
    createIssue("INC-VERIFY-0002", "Incident", manager.id),
    createIssue("RCA-VERIFY-0001", "RCA", manager.id),
    createIssue("HOTFIX-VERIFY-0001", "Hotfix", manager.id),
    createIssue("CHG-VERIFY-0001", "ChangeRelease", manager.id, "QUARTERLY_RELEASE"),
    createIssue("CHG-VERIFY-0002", "ChangeRelease", manager.id, "QUARTERLY_RELEASE"),
  ]);

  const workflowBefore = await prisma.issue.findMany({
    where: { id: { in: [incident.id, incident2.id, rca.id, hotfix.id, project1.id, project2.id] } },
    select: {
      id: true,
      workflowStatus: true,
      workflowVersionId: true,
      currentWorkflowStageId: true,
      assignedTeamId: true,
      ownerUserId: true,
    },
    orderBy: { id: "asc" },
  });

  const incidentToRca = await createIssueRelationForActor(manager.id, {
    sourceIssueId: incident.id,
    targetIssueId: rca.id,
    relationType: "INCIDENT_TO_RCA",
  });
  const incidentToHotfix = await createIssueRelationForActor(manager.id, {
    sourceIssueId: incident.id,
    targetIssueId: hotfix.id,
    relationType: "INCIDENT_TO_HOTFIX",
  });
  const rcaToHotfix = await createIssueRelationForActor(manager.id, {
    sourceIssueId: rca.id,
    targetIssueId: hotfix.id,
    relationType: "RCA_TO_HOTFIX",
  });
  const hotfixToProject = await createIssueRelationForActor(manager.id, {
    sourceIssueId: hotfix.id,
    targetIssueId: project1.id,
    relationType: "HOTFIX_TO_PROJECT",
  });
  check(
    "[1] 四種 relationType 皆可依固定方向建立",
    [
      incidentToRca.relationType,
      incidentToHotfix.relationType,
      rcaToHotfix.relationType,
      hotfixToProject.relationType,
    ].join(",") ===
      "INCIDENT_TO_RCA,INCIDENT_TO_HOTFIX,RCA_TO_HOTFIX,HOTFIX_TO_PROJECT",
  );

  const outgoing = await getRelatedIssuesByTypeForActor(
    manager.id,
    incident.id,
    "INCIDENT_TO_RCA",
  );
  const incoming = await getRelatedIssuesByTypeForActor(
    manager.id,
    rca.id,
    "INCIDENT_TO_RCA",
  );
  check(
    "[2] source／target 均可雙向查詢同一關聯",
    outgoing.length === 1 &&
      outgoing[0].direction === "OUTGOING" &&
      outgoing[0].issue.id === rca.id &&
      incoming.length === 1 &&
      incoming[0].direction === "INCOMING" &&
      incoming[0].issue.id === incident.id,
  );

  await expectError(
    "[3] 相同 active 關聯無法重複建立",
    IssueRelationConflictError,
    () =>
      createIssueRelationForActor(manager.id, {
        sourceIssueId: incident.id,
        targetIssueId: rca.id,
        relationType: "INCIDENT_TO_RCA",
      }),
  );
  await expectError(
    "[4] 一張 Hotfix 無法同時關聯兩個 active 季度專案",
    IssueRelationConflictError,
    () =>
      createIssueRelationForActor(manager.id, {
        sourceIssueId: hotfix.id,
        targetIssueId: project2.id,
        relationType: "HOTFIX_TO_PROJECT",
      }),
  );

  const removed = await removeIssueRelationForActor(manager.id, {
    relationId: incidentToRca.id,
    removalReason: "隔離測試解除後重新建立",
  });
  const recreated = await createIssueRelationForActor(manager.id, {
    sourceIssueId: incident.id,
    targetIssueId: rca.id,
    relationType: "INCIDENT_TO_RCA",
  });
  check(
    "[5] 解除後重新關聯會新增資料列",
    recreated.id !== removed.id && removed.removedAt instanceof Date,
  );

  const withHistory = await getDirectIssueRelationsForActor(
    manager.id,
    incident.id,
    { includeRemoved: true },
  );
  const incidentRcaHistory = withHistory.filter(
    (row) => row.relationType === "INCIDENT_TO_RCA",
  );
  check(
    "[6] 舊解除紀錄仍保留且新關聯為 active",
    incidentRcaHistory.length === 2 &&
      incidentRcaHistory.some(
        (row) =>
          row.id === removed.id &&
          row.removalReason === "隔離測試解除後重新建立" &&
          row.removedById === manager.id,
      ) &&
      incidentRcaHistory.some(
        (row) => row.id === recreated.id && row.removedAt === null,
      ),
  );

  await expectError(
    "[7] 解除原因必填",
    IssueRelationValidationError,
    () =>
      removeIssueRelationForActor(manager.id, {
        relationId: incidentToHotfix.id,
        removalReason: "   ",
      }),
  );
  await expectError(
    "[8] 錯誤 source／target 類型組合被拒絕",
    IssueRelationValidationError,
    () =>
      createIssueRelationForActor(manager.id, {
        sourceIssueId: hotfix.id,
        targetIssueId: rca.id,
        relationType: "INCIDENT_TO_RCA",
      }),
  );

  await expectError(
    "[9a] 無管理權使用者無法建立關聯且 User.role=Admin 不生效",
    IssueRelationAccessDeniedError,
    () =>
      createIssueRelationForActor(viewerOnly.id, {
        sourceIssueId: incident2.id,
        targetIssueId: hotfix.id,
        relationType: "INCIDENT_TO_HOTFIX",
      }),
  );
  await expectError(
    "[9b] 無管理權使用者無法解除關聯",
    IssueRelationAccessDeniedError,
    () =>
      removeIssueRelationForActor(viewerOnly.id, {
        relationId: incidentToHotfix.id,
        removalReason: "不得成功",
      }),
  );

  const workflowAfter = await prisma.issue.findMany({
    where: { id: { in: [incident.id, incident2.id, rca.id, hotfix.id, project1.id, project2.id] } },
    select: {
      id: true,
      workflowStatus: true,
      workflowVersionId: true,
      currentWorkflowStageId: true,
      assignedTeamId: true,
      ownerUserId: true,
    },
    orderBy: { id: "asc" },
  });
  check(
    "[10] 關聯建立／解除未改變 Workflow、assignment 或工單狀態",
    JSON.stringify(workflowAfter) === JSON.stringify(workflowBefore),
  );

  const auditRows = await prisma.auditLog.findMany({
    where: { entityType: "IssueRelation" },
    orderBy: { createdAt: "asc" },
  });
  check(
    "[11] 建立與解除均在同一交易寫入 AuditLog",
    auditRows.filter((row) => row.actionType === "IssueRelationCreated").length === 5 &&
      auditRows.filter((row) => row.actionType === "IssueRelationRemoved").length === 1 &&
      auditRows.every((row) => row.actorUserId === manager.id),
  );

  const partialIndexes = await prisma.$queryRaw<Array<{ name: string; sql: string }>>(
    Prisma.sql`
      SELECT "name", "sql"
      FROM "sqlite_master"
      WHERE "type" = 'index'
        AND "name" IN (
          'IssueRelation_active_pair_unique',
          'IssueRelation_active_hotfix_project_unique'
        )
      ORDER BY "name"
    `,
  );
  check(
    "[12] scratch DB 具備兩個 SQLite partial unique indexes",
    partialIndexes.length === 2 &&
      partialIndexes.every((index) => index.sql.includes("WHERE")) &&
      partialIndexes.some((index) => index.sql.includes("HOTFIX_TO_PROJECT")),
  );

  check(
    "[13] 正式 dev.db SHA-256 維持既有基準",
    formalHashBefore === FORMAL_DEV_DB_SHA256 &&
      hash(FORMAL_DEV_DB) === FORMAL_DEV_DB_SHA256,
  );
  check(
    "[14] 現有 Preview DB 未重建或修改",
    previewHashBefore === PREVIEW_DB_SHA256 &&
      hash(PREVIEW_DB) === PREVIEW_DB_SHA256,
  );

  console.log(`\n結果：PASS ${passed} / FAIL ${failed}`);
  await prisma.$disconnect();
  if (failed > 0) process.exit(1);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
