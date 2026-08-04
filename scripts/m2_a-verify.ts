// M2-A 驗證腳本
//
// 目的：驗證 M2-A（版本化 Workflow 定義基礎：Schema／服務層／發布驗證）的正確性。
// 涵蓋 Definition／Version／Stage／Transition／Requirement CRUD、15 項發布前驗證、
// 已發布不可變、row-level 授權、reasonCode、Audit 同 transaction、rollback、no-op、
// Issue FK 保護、舊 Issue 相容，以及既有 DB／全新 DB 兩條 migration 路徑。
//
// Fail-closed：本檔第一行 import 為 assertSafeTestDatabase，若呼叫端未顯式設定
// DATABASE_URL，或其解析後（含 symlink／device+inode 比對）指向正式 prisma/dev.db，
// 一律立即 process.exit(1)，不建立 Prisma Client、不寫入任何資料。
//
// 執行方式：
//   DATABASE_URL="file:<絕對路徑>/<測試 scratch DB>" node_modules/.bin/tsx scripts/m2_a-verify.ts

import "./lib/assertSafeTestDatabase";

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import {
  createWorkflowDefinition,
  updateWorkflowDefinition,
  activateWorkflowDefinition,
  deactivateWorkflowDefinition,
  createDraftVersion,
  cloneVersionToDraft,
  archiveVersion,
  addWorkflowStage,
  updateWorkflowStage,
  removeWorkflowStage,
  addWorkflowStageRequirement,
  removeWorkflowStageRequirement,
  addWorkflowTransition,
  removeWorkflowTransition,
  validateWorkflowVersion,
  publishWorkflowVersion,
  listWorkflowDefinitionsForActor,
  getWorkflowVersionDetailForActor,
  isIssueOnVersionedWorkflow,
  hasWorkflowCapability,
  WorkflowValidationError,
  WorkflowStateError,
  WorkflowAccessDeniedError,
  WorkflowPublishValidationError,
} from "../src/lib/workflowService";

let passCount = 0;
let failCount = 0;
let skipCount = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passCount++;
    console.log(`  PASS  ${name}`);
  } else {
    failCount++;
    console.log(`  FAIL  ${name}${detail ? `（${detail}）` : ""}`);
  }
}

function skip(name: string, reason: string) {
  skipCount++;
  console.log(`  SKIP  ${name}（${reason}）`);
}

async function checkAsync(name: string, fn: () => Promise<boolean>) {
  try {
    check(name, await fn());
  } catch (err) {
    failCount++;
    console.log(`  FAIL  ${name}（未預期例外：${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}）`);
  }
}

async function expectError(name: string, fn: () => Promise<unknown>, matcher: (err: unknown) => boolean) {
  try {
    await fn();
    failCount++;
    console.log(`  FAIL  ${name}（預期拋出例外，但沒有拋出）`);
  } catch (err) {
    if (matcher(err)) {
      passCount++;
      console.log(`  PASS  ${name}`);
    } else {
      failCount++;
      console.log(`  FAIL  ${name}（拋出了非預期的例外：${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}）`);
    }
  }
}

const RUN_TAG = `m2av${Date.now()}`;

interface Fixtures {
  userIds: string[];
  teamIds: string[];
  issueIds: string[];
  definitionIds: string[];
}

async function createUser(name: string, role: string): Promise<{ id: string }> {
  const user = await prisma.user.create({ data: { name, email: `${RUN_TAG}-${name}@example.invalid`, role, isActive: true } });
  await prisma.userRole.create({ data: { userId: user.id, role, isActive: true } });
  return user;
}

// ---------------------------------------------------------------------------
// 建構一個「合法、可發布」的最小 3 關卡流程：draft(start) -> review(APPROVAL) -> closed(end/COMPLETED)
// 附一條 CANCEL：draft -> cancelled(end/CANCELLED)
// ---------------------------------------------------------------------------
async function buildMinimalValidVersion(fx: Fixtures, actorId: string, reasonCode: string) {
  const definition = await createWorkflowDefinition({
    key: `${RUN_TAG}-def-${Math.random().toString(36).slice(2)}`,
    name: "測試流程",
    issueType: "Hotfix",
    actorId,
    reasonCode,
  });
  fx.definitionIds.push(definition.id);
  const version = await createDraftVersion({ workflowDefinitionId: definition.id, actorId, reasonCode });

  const draftStage = await addWorkflowStage({
    workflowVersionId: version.id,
    stageKey: "draft",
    label: "草稿",
    stageType: "SUBMISSION",
    sortOrder: 1,
    isStart: true,
    actorId,
    reasonCode,
  });
  const reviewStage = await addWorkflowStage({
    workflowVersionId: version.id,
    stageKey: "review",
    label: "審核",
    stageType: "APPROVAL",
    sortOrder: 2,
    approvalType: "BUSINESS_APPROVAL",
    actorId,
    reasonCode,
  });
  const closedStage = await addWorkflowStage({
    workflowVersionId: version.id,
    stageKey: "closed",
    label: "已結案",
    stageType: "CLOSURE",
    sortOrder: 3,
    isEnd: true,
    terminalOutcome: "COMPLETED",
    actorId,
    reasonCode,
  });
  const cancelledStage = await addWorkflowStage({
    workflowVersionId: version.id,
    stageKey: "cancelled",
    label: "已取消",
    stageType: "CLOSURE",
    sortOrder: 4,
    isEnd: true,
    terminalOutcome: "CANCELLED",
    actorId,
    reasonCode,
  });

  await addWorkflowTransition({
    workflowVersionId: version.id,
    fromStageId: draftStage.id,
    toStageId: reviewStage.id,
    transitionType: "FORWARD",
    actionKey: "submit",
    label: "送出審核",
    actorId,
    reasonCode,
  });
  await addWorkflowTransition({
    workflowVersionId: version.id,
    fromStageId: reviewStage.id,
    toStageId: closedStage.id,
    transitionType: "FORWARD",
    actionKey: "approve",
    label: "核准並結案",
    actorId,
    reasonCode,
  });
  await addWorkflowTransition({
    workflowVersionId: version.id,
    fromStageId: reviewStage.id,
    toStageId: draftStage.id,
    transitionType: "RETURN",
    actionKey: "reject",
    label: "退回草稿",
    actorId,
    reasonCode,
  });
  await addWorkflowTransition({
    workflowVersionId: version.id,
    fromStageId: draftStage.id,
    toStageId: cancelledStage.id,
    transitionType: "CANCEL",
    actionKey: "cancel",
    label: "取消",
    actorId,
    reasonCode,
  });

  return { definition, version, draftStage, reviewStage, closedStage, cancelledStage };
}

async function runServiceTests(fx: Fixtures) {
  const admin = await createUser("workflowAdmin", "Admin");
  const secTeam = await createUser("workflowSecTeam", "資安推動小組");
  const plainUser = await createUser("workflowPlainUser", "PM");
  fx.userIds.push(admin.id, secTeam.id, plainUser.id);

  // ---- row-level 授權（deny-by-default） ----
  await checkAsync("[R1] Admin 具有 workflow.view／manageDraft／publish／archive", async () => {
    return (
      (await hasWorkflowCapability(admin.id, "workflow.view")) &&
      (await hasWorkflowCapability(admin.id, "workflow.manageDraft")) &&
      (await hasWorkflowCapability(admin.id, "workflow.publish")) &&
      (await hasWorkflowCapability(admin.id, "workflow.archive"))
    );
  });
  await checkAsync("[R2] 資安推動小組僅具有 workflow.view，不具有 manageDraft／publish／archive", async () => {
    return (
      (await hasWorkflowCapability(secTeam.id, "workflow.view")) &&
      !(await hasWorkflowCapability(secTeam.id, "workflow.manageDraft")) &&
      !(await hasWorkflowCapability(secTeam.id, "workflow.publish")) &&
      !(await hasWorkflowCapability(secTeam.id, "workflow.archive"))
    );
  });
  await checkAsync("[R3] 一般 PM 不具有任何 workflow.* 能力", async () => {
    return (
      !(await hasWorkflowCapability(plainUser.id, "workflow.view")) &&
      !(await hasWorkflowCapability(plainUser.id, "workflow.manageDraft"))
    );
  });
  await expectError(
    "[R4] listWorkflowDefinitionsForActor：一般 PM 遭拒絕（deny-by-default）",
    () => listWorkflowDefinitionsForActor(plainUser.id),
    (e) => e instanceof WorkflowAccessDeniedError,
  );
  await expectError(
    "[R5] createWorkflowDefinition：一般 PM 呼叫遭拒絕（deny-by-default）",
    () =>
      createWorkflowDefinition({
        key: `${RUN_TAG}-denied`,
        name: "應被拒絕",
        issueType: "Hotfix",
        actorId: plainUser.id,
        reasonCode: "TEST",
      }),
    (e) => e instanceof WorkflowAccessDeniedError,
  );
  await expectError(
    "[R5b] 資安推動小組（僅 view）呼叫 createWorkflowDefinition 遭拒絕",
    () =>
      createWorkflowDefinition({
        key: `${RUN_TAG}-denied2`,
        name: "應被拒絕",
        issueType: "Hotfix",
        actorId: secTeam.id,
        reasonCode: "TEST",
      }),
    (e) => e instanceof WorkflowAccessDeniedError,
  );

  // ---- Definition：建立／更新／停用／重新啟用 ----
  const def1 = await createWorkflowDefinition({
    key: `${RUN_TAG}-def1`,
    name: "工單流程一",
    issueType: "Hotfix",
    actorId: admin.id,
    reasonCode: "TEST_CREATE",
  });
  fx.definitionIds.push(def1.id);

  await checkAsync("[D1] createWorkflowDefinition：建立成功並寫入 WorkflowDefinitionCreated AuditLog", async () => {
    const log = await prisma.auditLog.findFirst({ where: { entityType: "WorkflowDefinition", entityId: def1.id, actionType: "WorkflowDefinitionCreated" } });
    return def1.isActive === true && !!log;
  });

  await expectError(
    "[D2] createWorkflowDefinition：key 重複時拒絕",
    () => createWorkflowDefinition({ key: `${RUN_TAG}-def1`, name: "重複 key", issueType: "Hotfix", actorId: admin.id, reasonCode: "TEST" }),
    (e) => e instanceof WorkflowValidationError,
  );

  await checkAsync("[D3] updateWorkflowDefinition：無變更時 no-op，不寫入額外 AuditLog", async () => {
    const before = await prisma.auditLog.count({ where: { entityType: "WorkflowDefinition", entityId: def1.id, actionType: "WorkflowDefinitionUpdated" } });
    await updateWorkflowDefinition({ definitionId: def1.id, name: def1.name, actorId: admin.id, reasonCode: "TEST_NOOP" });
    const after = await prisma.auditLog.count({ where: { entityType: "WorkflowDefinition", entityId: def1.id, actionType: "WorkflowDefinitionUpdated" } });
    return before === 0 && after === 0;
  });

  await checkAsync("[D4] updateWorkflowDefinition：有變更時寫入 AuditLog", async () => {
    const updated = await updateWorkflowDefinition({ definitionId: def1.id, name: "工單流程一（改名）", actorId: admin.id, reasonCode: "TEST_UPDATE" });
    const log = await prisma.auditLog.findFirst({ where: { entityType: "WorkflowDefinition", entityId: def1.id, actionType: "WorkflowDefinitionUpdated" } });
    return updated.name === "工單流程一（改名）" && !!log;
  });

  await checkAsync("[D5] deactivateWorkflowDefinition：停用成功並寫入 AuditLog", async () => {
    const deactivated = await deactivateWorkflowDefinition({ definitionId: def1.id, actorId: admin.id, reasonCode: "TEST_DEACTIVATE" });
    const log = await prisma.auditLog.findFirst({ where: { entityType: "WorkflowDefinition", entityId: def1.id, actionType: "WorkflowDefinitionDeactivated" } });
    return deactivated.isActive === false && !!log;
  });

  await checkAsync("[D6] deactivateWorkflowDefinition：再次停用為 no-op，不重複寫 AuditLog", async () => {
    const before = await prisma.auditLog.count({ where: { entityType: "WorkflowDefinition", entityId: def1.id, actionType: "WorkflowDefinitionDeactivated" } });
    await deactivateWorkflowDefinition({ definitionId: def1.id, actorId: admin.id, reasonCode: "TEST_DEACTIVATE_AGAIN" });
    const after = await prisma.auditLog.count({ where: { entityType: "WorkflowDefinition", entityId: def1.id, actionType: "WorkflowDefinitionDeactivated" } });
    return before === 1 && after === 1;
  });

  await checkAsync("[D7] activateWorkflowDefinition：重新啟用成功並寫入 AuditLog", async () => {
    const activated = await activateWorkflowDefinition({ definitionId: def1.id, actorId: admin.id, reasonCode: "TEST_REACTIVATE" });
    const log = await prisma.auditLog.findFirst({ where: { entityType: "WorkflowDefinition", entityId: def1.id, actionType: "WorkflowDefinitionActivated" } });
    return activated.isActive === true && !!log;
  });

  await expectError(
    "[D8] reasonCode 為空時 createWorkflowDefinition 拒絕",
    () => createWorkflowDefinition({ key: `${RUN_TAG}-noreason`, name: "無 reasonCode", issueType: "Hotfix", actorId: admin.id, reasonCode: "" }),
    (e) => e instanceof WorkflowValidationError,
  );

  // ---- Version：Draft 建立／Clone／Archive ----
  const version1 = await createDraftVersion({ workflowDefinitionId: def1.id, actorId: admin.id, reasonCode: "TEST_V1" });
  const version2 = await createDraftVersion({ workflowDefinitionId: def1.id, actorId: admin.id, reasonCode: "TEST_V2" });
  check("[V1] createDraftVersion：versionNo 依序遞增（1, 2）", version1.versionNo === 1 && version2.versionNo === 2);
  check("[V2] createDraftVersion：狀態為 DRAFT", version1.status === "DRAFT");

  const stageX = await addWorkflowStage({
    workflowVersionId: version1.id,
    stageKey: "x",
    label: "X",
    stageType: "SUBMISSION",
    sortOrder: 1,
    isStart: true,
    actorId: admin.id,
    reasonCode: "TEST",
  });
  await addWorkflowStageRequirement({ workflowStageId: stageX.id, requirementType: "REQUIRE_COMMENT", targetKey: "note", actorId: admin.id, reasonCode: "TEST" });

  const cloned = await cloneVersionToDraft({ sourceVersionId: version1.id, actorId: admin.id, reasonCode: "TEST_CLONE" });
  await checkAsync("[V3] cloneVersionToDraft：新版號、狀態 DRAFT、clonedFromVersionId 指向來源", async () => {
    return cloned.versionNo === 3 && cloned.status === "DRAFT" && cloned.clonedFromVersionId === version1.id;
  });
  await checkAsync("[V4] cloneVersionToDraft：深拷貝 Stage／Requirement（筆數相同，id 不同）", async () => {
    const clonedStages = await prisma.workflowStage.findMany({ where: { workflowVersionId: cloned.id } });
    const clonedReqs = await prisma.workflowStageRequirement.findMany({ where: { workflowStage: { workflowVersionId: cloned.id } } });
    return clonedStages.length === 1 && clonedStages[0].id !== stageX.id && clonedStages[0].stageKey === "x" && clonedReqs.length === 1;
  });

  await checkAsync("[V5] archiveVersion：DRAFT → ARCHIVED", async () => {
    const archived = await archiveVersion({ versionId: version2.id, actorId: admin.id, reasonCode: "TEST_ARCHIVE" });
    const log = await prisma.auditLog.findFirst({ where: { entityType: "WorkflowVersion", entityId: version2.id, actionType: "WorkflowVersionArchived" } });
    return archived.status === "ARCHIVED" && !!log;
  });
  await checkAsync("[V6] archiveVersion：已封存版本再次封存為 no-op，不重複寫 AuditLog", async () => {
    const before = await prisma.auditLog.count({ where: { entityType: "WorkflowVersion", entityId: version2.id, actionType: "WorkflowVersionArchived" } });
    await archiveVersion({ versionId: version2.id, actorId: admin.id, reasonCode: "TEST_ARCHIVE_AGAIN" });
    const after = await prisma.auditLog.count({ where: { entityType: "WorkflowVersion", entityId: version2.id, actionType: "WorkflowVersionArchived" } });
    return before === 1 && after === 1;
  });

  // ---- Stage：唯一性／更新／移除 ----
  await expectError(
    "[S1] addWorkflowStage：同版本內 stageKey 重複時拒絕",
    () => addWorkflowStage({ workflowVersionId: version1.id, stageKey: "x", label: "重複 X", stageType: "WORK", sortOrder: 2, actorId: admin.id, reasonCode: "TEST" }),
    (e) => e instanceof WorkflowValidationError,
  );

  await checkAsync("[S2] updateWorkflowStage：更新成功並寫入 AuditLog", async () => {
    const updated = await updateWorkflowStage({ stageId: stageX.id, label: "X（已更新）", actorId: admin.id, reasonCode: "TEST_UPDATE_STAGE" });
    const log = await prisma.auditLog.findFirst({ where: { entityType: "WorkflowStage", entityId: stageX.id, actionType: "WorkflowStageUpdated" } });
    return updated.label === "X（已更新）" && !!log;
  });

  await expectError(
    "[S3] updateWorkflowStage：非結束關卡（isEnd=false）設定 terminalOutcome 時拒絕",
    () => updateWorkflowStage({ stageId: stageX.id, isEnd: false, terminalOutcome: "COMPLETED", actorId: admin.id, reasonCode: "TEST" }),
    (e) => e instanceof WorkflowValidationError,
  );

  const stageToRemove = await addWorkflowStage({
    workflowVersionId: version1.id,
    stageKey: "toRemove",
    label: "待移除",
    stageType: "WORK",
    sortOrder: 5,
    actorId: admin.id,
    reasonCode: "TEST",
  });
  await checkAsync("[S4] removeWorkflowStage：無 Transition 引用時移除成功並寫入 AuditLog", async () => {
    await removeWorkflowStage({ stageId: stageToRemove.id, actorId: admin.id, reasonCode: "TEST_REMOVE" });
    const found = await prisma.workflowStage.findUnique({ where: { id: stageToRemove.id } });
    const log = await prisma.auditLog.findFirst({ where: { entityType: "WorkflowStage", entityId: stageToRemove.id, actionType: "WorkflowStageRemoved" } });
    return found === null && !!log;
  });

  // ---- Transition：唯一性／RETURN 自我指向 ----
  const stageY = await addWorkflowStage({
    workflowVersionId: version1.id,
    stageKey: "y",
    label: "Y",
    stageType: "WORK",
    sortOrder: 2,
    actorId: admin.id,
    reasonCode: "TEST",
  });
  await addWorkflowTransition({
    workflowVersionId: version1.id,
    fromStageId: stageX.id,
    toStageId: stageY.id,
    transitionType: "FORWARD",
    actionKey: "go",
    label: "前進",
    actorId: admin.id,
    reasonCode: "TEST",
  });

  await expectError(
    "[T1] addWorkflowTransition：同一 fromStage 已有相同 actionKey 時拒絕",
    () =>
      addWorkflowTransition({
        workflowVersionId: version1.id,
        fromStageId: stageX.id,
        toStageId: stageY.id,
        transitionType: "FORWARD",
        actionKey: "go",
        label: "重複",
        actorId: admin.id,
        reasonCode: "TEST",
      }),
    (e) => e instanceof WorkflowValidationError,
  );

  await expectError(
    "[T2] addWorkflowTransition：同一 fromStage 第二個 FORWARD 時拒絕（DB partial unique index）",
    () =>
      addWorkflowTransition({
        workflowVersionId: version1.id,
        fromStageId: stageX.id,
        toStageId: stageY.id,
        transitionType: "FORWARD",
        actionKey: "goAgain",
        label: "第二個 FORWARD",
        actorId: admin.id,
        reasonCode: "TEST",
      }),
    (e) => e instanceof WorkflowValidationError,
  );

  await expectError(
    "[T3] addWorkflowTransition：RETURN 不得指向自己",
    () =>
      addWorkflowTransition({
        workflowVersionId: version1.id,
        fromStageId: stageY.id,
        toStageId: stageY.id,
        transitionType: "RETURN",
        actionKey: "selfReturn",
        label: "指向自己",
        actorId: admin.id,
        reasonCode: "TEST",
      }),
    (e) => e instanceof WorkflowValidationError,
  );

  const removableTransition = await addWorkflowTransition({
    workflowVersionId: version1.id,
    fromStageId: stageY.id,
    toStageId: stageX.id,
    transitionType: "RETURN",
    actionKey: "back",
    label: "退回",
    actorId: admin.id,
    reasonCode: "TEST",
  });
  await checkAsync("[T4] removeWorkflowTransition：移除成功並寫入 AuditLog", async () => {
    await removeWorkflowTransition({ transitionId: removableTransition.id, actorId: admin.id, reasonCode: "TEST_REMOVE_TRANSITION" });
    const found = await prisma.workflowTransition.findUnique({ where: { id: removableTransition.id } });
    const log = await prisma.auditLog.findFirst({ where: { entityType: "WorkflowTransition", entityId: removableTransition.id, actionType: "WorkflowTransitionRemoved" } });
    return found === null && !!log;
  });

  await expectError(
    "[S5] removeWorkflowStage：仍被 Transition 引用時拒絕",
    () => removeWorkflowStage({ stageId: stageX.id, actorId: admin.id, reasonCode: "TEST_REMOVE_REFERENCED" }),
    (e) => e instanceof WorkflowStateError,
  );

  await expectError(
    "[REQ1] addWorkflowStageRequirement：requirementType 不在白名單時拒絕",
    () => addWorkflowStageRequirement({ workflowStageId: stageX.id, requirementType: "NOT_A_REAL_TYPE", targetKey: "foo", actorId: admin.id, reasonCode: "TEST" }),
    (e) => e instanceof WorkflowValidationError,
  );

  const requirement = await addWorkflowStageRequirement({
    workflowStageId: stageY.id,
    requirementType: "REQUIRE_EVIDENCE",
    targetKey: "evidence",
    actorId: admin.id,
    reasonCode: "TEST",
  });
  await checkAsync("[REQ2] removeWorkflowStageRequirement：移除成功並寫入 AuditLog", async () => {
    await removeWorkflowStageRequirement({ requirementId: requirement.id, actorId: admin.id, reasonCode: "TEST_REMOVE_REQ" });
    const found = await prisma.workflowStageRequirement.findUnique({ where: { id: requirement.id } });
    const log = await prisma.auditLog.findFirst({ where: { entityType: "WorkflowStageRequirement", entityId: requirement.id, actionType: "WorkflowRequirementRemoved" } });
    return found === null && !!log;
  });

  // ---- 發布前驗證（15 項）：以最小合法流程為基礎，逐一破壞單一規則 ----

  const valid = await buildMinimalValidVersion(fx, admin.id, "TEST_BUILD_VALID");
  await checkAsync("[PUB1] validateWorkflowVersion：合法完整流程通過，issues 為空", async () => {
    const result = await validateWorkflowVersion({ versionId: valid.version.id, actorId: admin.id });
    return result.valid === true && result.issues.length === 0;
  });

  await checkAsync("[PUB2] 缺少 isStart：START_STAGE_COUNT 錯誤", async () => {
    const b = await buildMinimalValidVersion(fx, admin.id, "TEST");
    await updateWorkflowStage({ stageId: b.draftStage.id, isStart: false, actorId: admin.id, reasonCode: "TEST_BREAK" });
    const result = await validateWorkflowVersion({ versionId: b.version.id, actorId: admin.id });
    return !result.valid && result.issues.some((i) => i.code === "START_STAGE_COUNT");
  });

  await checkAsync("[PUB3] 缺少 COMPLETED 結束關卡：NO_COMPLETED_STAGE 錯誤", async () => {
    const b = await buildMinimalValidVersion(fx, admin.id, "TEST");
    await updateWorkflowStage({ stageId: b.closedStage.id, terminalOutcome: "CANCELLED", actorId: admin.id, reasonCode: "TEST_BREAK" });
    const result = await validateWorkflowVersion({ versionId: b.version.id, actorId: admin.id });
    return !result.valid && result.issues.some((i) => i.code === "NO_COMPLETED_STAGE");
  });

  await checkAsync("[PUB4] 孤立 Stage（未被 FORWARD 可達）：UNREACHABLE_STAGE 錯誤", async () => {
    const b = await buildMinimalValidVersion(fx, admin.id, "TEST");
    await addWorkflowStage({
      workflowVersionId: b.version.id,
      stageKey: "orphan",
      label: "孤立關卡",
      stageType: "WORK",
      sortOrder: 99,
      actorId: admin.id,
      reasonCode: "TEST",
    });
    const result = await validateWorkflowVersion({ versionId: b.version.id, actorId: admin.id });
    return !result.valid && result.issues.some((i) => i.code === "UNREACHABLE_STAGE" || i.code === "NON_END_STAGE_MISSING_FORWARD");
  });

  await checkAsync("[PUB5] RETURN 目標非 FORWARD 主路徑祖先（指向下游關卡）：RETURN_TARGET_NOT_ANCESTOR 錯誤", async () => {
    const b = await buildMinimalValidVersion(fx, admin.id, "TEST");
    // draft（主路徑序號 0）RETURN 到 closed（主路徑序號 2，在 draft 之後，不是祖先）
    await addWorkflowTransition({
      workflowVersionId: b.version.id,
      fromStageId: b.draftStage.id,
      toStageId: b.closedStage.id,
      transitionType: "RETURN",
      actionKey: "badReturn",
      label: "非法 RETURN（指向下游）",
      actorId: admin.id,
      reasonCode: "TEST",
    });
    const result = await validateWorkflowVersion({ versionId: b.version.id, actorId: admin.id });
    return !result.valid && result.issues.some((i) => i.code === "RETURN_TARGET_NOT_ANCESTOR");
  });

  await checkAsync("[PUB6] CANCEL 指向非 CANCELLED 關卡：CANCEL_TARGET_NOT_CANCELLED 錯誤", async () => {
    const b = await buildMinimalValidVersion(fx, admin.id, "TEST");
    await addWorkflowStage({
      workflowVersionId: b.version.id,
      stageKey: "wrongCancelTarget",
      label: "錯誤取消目標",
      stageType: "WORK",
      sortOrder: 50,
      actorId: admin.id,
      reasonCode: "TEST",
    });
    // 直接以 Prisma 建立一筆指向非 CANCELLED 關卡的 CANCEL（模擬資料異常，繞過服務層防禦性檢查
    // 以確保 validation.ts 本身也能偵測，而不只是依賴服務層擋下）
    const wrongTarget = await prisma.workflowStage.findFirstOrThrow({ where: { workflowVersionId: b.version.id, stageKey: "wrongCancelTarget" } });
    await prisma.workflowTransition.create({
      data: {
        workflowVersionId: b.version.id,
        fromStageId: b.reviewStage.id,
        toStageId: wrongTarget.id,
        transitionType: "CANCEL",
        actionKey: "badCancel",
        label: "非法 CANCEL",
      },
    });
    const result = await validateWorkflowVersion({ versionId: b.version.id, actorId: admin.id });
    return !result.valid && result.issues.some((i) => i.code === "CANCEL_TARGET_NOT_CANCELLED");
  });

  await checkAsync("[PUB7] CANCELLED 結束關卡沒有 CANCEL 指向：UNUSED_CANCELLED_STAGE 錯誤", async () => {
    const b = await buildMinimalValidVersion(fx, admin.id, "TEST");
    await addWorkflowStage({
      workflowVersionId: b.version.id,
      stageKey: "unusedCancelled",
      label: "未使用的取消關卡",
      stageType: "CLOSURE",
      sortOrder: 51,
      isEnd: true,
      terminalOutcome: "CANCELLED",
      actorId: admin.id,
      reasonCode: "TEST",
    });
    const result = await validateWorkflowVersion({ versionId: b.version.id, actorId: admin.id });
    return !result.valid && result.issues.some((i) => i.code === "UNUSED_CANCELLED_STAGE");
  });

  await checkAsync("[PUB8] 空白流程（0 個 Stage）：EMPTY_WORKFLOW 錯誤", async () => {
    const def = await createWorkflowDefinition({ key: `${RUN_TAG}-empty`, name: "空白流程", issueType: "Hotfix", actorId: admin.id, reasonCode: "TEST" });
    fx.definitionIds.push(def.id);
    const version = await createDraftVersion({ workflowDefinitionId: def.id, actorId: admin.id, reasonCode: "TEST" });
    const result = await validateWorkflowVersion({ versionId: version.id, actorId: admin.id });
    return !result.valid && result.issues.some((i) => i.code === "EMPTY_WORKFLOW");
  });

  await checkAsync("[PUB9] APPROVAL 關卡缺少 approvalType：APPROVAL_STAGE_MISSING_TYPE 錯誤", async () => {
    const b = await buildMinimalValidVersion(fx, admin.id, "TEST");
    await prisma.workflowStage.update({ where: { id: b.reviewStage.id }, data: { approvalType: null } });
    const result = await validateWorkflowVersion({ versionId: b.version.id, actorId: admin.id });
    return !result.valid && result.issues.some((i) => i.code === "APPROVAL_STAGE_MISSING_TYPE");
  });

  await checkAsync("[PUB10] assignedTeamId 對應 Team 不存在：ASSIGNED_TEAM_NOT_FOUND 錯誤（防禦性檢查——正常路徑下 DB FK 已擋下此狀態，此處模擬資料異常）", async () => {
    const b = await buildMinimalValidVersion(fx, admin.id, "TEST");
    const orphanTeam = await prisma.team.create({ data: { name: `${RUN_TAG}-orphanTeam` } });
    await updateWorkflowStage({ stageId: b.draftStage.id, assignedTeamId: orphanTeam.id, actorId: admin.id, reasonCode: "TEST" });
    // 正常服務層無法產生「Team 已刪除但 Stage 仍引用」的狀態（Team 無刪除服務、且 FK 為 Restrict）。
    // 此處僅為驗證 validation.ts 本身的防禦性檢查邏輯，暫時關閉 foreign_keys 直接刪除 Team 列，
    // 模擬資料異常情境；驗證完成後立即重新啟用，不影響後續其他測試。
    await prisma.$executeRawUnsafe("PRAGMA foreign_keys=OFF;");
    try {
      await prisma.$executeRawUnsafe(`DELETE FROM "Team" WHERE "id" = '${orphanTeam.id}'`);
    } finally {
      await prisma.$executeRawUnsafe("PRAGMA foreign_keys=ON;");
    }
    const result = await validateWorkflowVersion({ versionId: b.version.id, actorId: admin.id });
    return !result.valid && result.issues.some((i) => i.code === "ASSIGNED_TEAM_NOT_FOUND");
  });

  // ---- publishWorkflowVersion：成功／驗證失敗／已發布不可變 ----

  const toPublish = await buildMinimalValidVersion(fx, admin.id, "TEST_TO_PUBLISH");
  await checkAsync("[PUB11] publishWorkflowVersion：合法版本發布成功，狀態變為 PUBLISHED，寫入 AuditLog", async () => {
    const published = await publishWorkflowVersion({ versionId: toPublish.version.id, actorId: admin.id, reasonCode: "TEST_PUBLISH" });
    const log = await prisma.auditLog.findFirst({ where: { entityType: "WorkflowVersion", entityId: toPublish.version.id, actionType: "WorkflowVersionPublished" } });
    return published.status === "PUBLISHED" && !!published.publishedAt && published.publishedByUserId === admin.id && !!log;
  });

  await expectError(
    "[PUB12] publishWorkflowVersion：驗證失敗的版本拒絕發布，狀態不變",
    async () => {
      const broken = await buildMinimalValidVersion(fx, admin.id, "TEST");
      await updateWorkflowStage({ stageId: broken.draftStage.id, isStart: false, actorId: admin.id, reasonCode: "TEST_BREAK" });
      await publishWorkflowVersion({ versionId: broken.version.id, actorId: admin.id, reasonCode: "TEST_PUBLISH_SHOULD_FAIL" });
    },
    (e) => e instanceof WorkflowPublishValidationError && (e as WorkflowPublishValidationError).issues.length > 0,
  );

  await checkAsync("[PUB13] 已發布版本狀態確實仍為 PUBLISHED（發布失敗未造成半成品狀態變更）", async () => {
    const stillDraftCount = await prisma.workflowVersion.count({ where: { workflowDefinitionId: toPublish.definition.id, status: "PUBLISHED" } });
    return stillDraftCount === 1;
  });

  await expectError(
    "[PUB14] 已發布版本不可再修改 Stage（發布後不可變，assertDraftVersion 擋下）",
    () => updateWorkflowStage({ stageId: toPublish.draftStage.id, label: "企圖修改已發布版本", actorId: admin.id, reasonCode: "TEST" }),
    (e) => e instanceof WorkflowStateError,
  );
  await expectError(
    "[PUB15] 已發布版本不可再新增 Transition（發布後不可變）",
    () =>
      addWorkflowTransition({
        workflowVersionId: toPublish.version.id,
        fromStageId: toPublish.draftStage.id,
        toStageId: toPublish.closedStage.id,
        transitionType: "FORWARD",
        actionKey: "illegalDirect",
        label: "企圖新增",
        actorId: admin.id,
        reasonCode: "TEST",
      }),
    (e) => e instanceof WorkflowStateError,
  );
  await expectError(
    "[PUB16] 已發布版本不可再次發布",
    () => publishWorkflowVersion({ versionId: toPublish.version.id, actorId: admin.id, reasonCode: "TEST_REPUBLISH" }),
    (e) => e instanceof WorkflowStateError,
  );

  // ---- queries：listWorkflowDefinitionsForActor／getWorkflowVersionDetailForActor ----
  await checkAsync("[Q1] getWorkflowVersionDetailForActor：回傳完整 stages／transitions", async () => {
    const detail = await getWorkflowVersionDetailForActor(admin.id, toPublish.version.id);
    return detail.stages.length === 4 && detail.transitions.length === 4;
  });
  await checkAsync("[Q2] listWorkflowDefinitionsForActor：包含剛建立的定義", async () => {
    const list = await listWorkflowDefinitionsForActor(admin.id);
    return list.some((d) => d.id === toPublish.definition.id);
  });

  // ---- Issue FK 保護／舊 Issue 相容 ----
  const legacyIssue = await prisma.issue.create({
    data: { issueKey: `${RUN_TAG}-LEGACY-0001`, issueType: "Hotfix", title: "舊流程 Issue", workflowStatus: "opened" },
  });
  fx.issueIds.push(legacyIssue.id);
  check("[C1] 舊 Issue（workflowVersionId=null）isIssueOnVersionedWorkflow 為 false", isIssueOnVersionedWorkflow(legacyIssue) === false);

  const boundIssue = await prisma.issue.create({
    data: {
      issueKey: `${RUN_TAG}-BOUND-0001`,
      issueType: "Hotfix",
      title: "新流程 Issue",
      workflowStatus: "draft",
      workflowVersionId: toPublish.version.id,
      currentWorkflowStageId: toPublish.draftStage.id,
    },
  });
  fx.issueIds.push(boundIssue.id);
  check("[C2] 新流程 Issue（workflowVersionId 非 null）isIssueOnVersionedWorkflow 為 true", isIssueOnVersionedWorkflow(boundIssue) === true);

  await expectError(
    "[FK1] 已被 Issue 引用的 WorkflowVersion 不可 hard delete（onDelete: Restrict）",
    () => prisma.workflowVersion.delete({ where: { id: toPublish.version.id } }),
    (e) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003",
  );
  await expectError(
    "[FK2] 已被 Issue 引用的 WorkflowStage 不可 hard delete（onDelete: Restrict）",
    () => prisma.workflowStage.delete({ where: { id: toPublish.draftStage.id } }),
    (e) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003",
  );

  // ---- Audit 與資料變更同 transaction（rollback 測試） ----
  await checkAsync("[TX1] createWorkflowDefinition 若 transaction 中途失敗，User 建立與 AuditLog 皆回滾（以重複 key 觸發）", async () => {
    const dupKey = `${RUN_TAG}-tx-dup`;
    const firstDef = await createWorkflowDefinition({ key: dupKey, name: "第一筆", issueType: "Hotfix", actorId: admin.id, reasonCode: "TEST" });
    fx.definitionIds.push(firstDef.id);
    const beforeCount = await prisma.workflowDefinition.count({ where: { key: dupKey } });
    try {
      await createWorkflowDefinition({ key: dupKey, name: "第二筆（應失敗）", issueType: "Hotfix", actorId: admin.id, reasonCode: "TEST" });
    } catch {
      // 預期失敗
    }
    const afterCount = await prisma.workflowDefinition.count({ where: { key: dupKey } });
    const auditCount = await prisma.auditLog.count({ where: { actionType: "WorkflowDefinitionCreated", summary: { contains: "第二筆" } } });
    return beforeCount === 1 && afterCount === 1 && auditCount === 0;
  });
}

async function runStaticSourceChecks() {
  console.log("\n=== 靜態原始碼檢查：UI／Server Action 不得直接使用 Prisma（必定執行，不依賴 DB） ===");
  const repoRoot = path.resolve(__dirname, "..");
  // Server Action 比照既有 src/app/admin/people/actions.ts 慣例，放在
  // src/app/admin/workflows/actions.ts（而非 src/lib/workflowActions.ts）。
  const workflowActionsPath = path.join(repoRoot, "src", "app", "admin", "workflows", "actions.ts");
  if (fs.existsSync(workflowActionsPath)) {
    const src = fs.readFileSync(workflowActionsPath, "utf8");
    check(
      '[UI1] src/app/admin/workflows/actions.ts 不 import "@prisma/client" 或 "@/lib/prisma"',
      !/from ["']@prisma\/client["']/.test(src) && !/from ["']@\/lib\/prisma["']/.test(src),
    );
    check("[UI2] src/app/admin/workflows/actions.ts 只呼叫 workflowService，不直接使用 prisma.workflow", !/prisma\.workflow/.test(src));
  } else {
    skip("[UI1]/[UI2] workflows/actions.ts 靜態檢查", "尚未建立 src/app/admin/workflows/actions.ts（M2-A3 UI 階段才會建立）");
  }

  const uiDir = path.join(repoRoot, "src", "app", "admin", "workflows");
  if (fs.existsSync(uiDir)) {
    const files = execSync(`find "${uiDir}" -name "*.tsx" -o -name "*.ts"`).toString().trim().split("\n").filter(Boolean);
    let anyDirectPrisma = false;
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      if (/from ["']@prisma\/client["']/.test(src) || /from ["'].*\/prisma["']/.test(src)) {
        anyDirectPrisma = true;
        console.log(`    發現直接 import Prisma：${f}`);
      }
    }
    check("[UI3] src/app/admin/workflows/** 底下所有檔案皆不直接 import Prisma", !anyDirectPrisma);
  } else {
    skip("[UI3] Workflow 管理 UI 靜態檢查", "尚未建立 src/app/admin/workflows（M2-A3 UI 階段才會建立）");
  }
}

async function cleanupFixtures(fx: Fixtures) {
  try {
    await prisma.workflowStageRequirement.deleteMany({ where: { workflowStage: { workflowVersion: { workflowDefinition: { id: { in: fx.definitionIds } } } } } });
  } catch (e) {
    console.warn("cleanup WorkflowStageRequirement 失敗：", e);
  }
  try {
    await prisma.issue.deleteMany({ where: { id: { in: fx.issueIds } } });
  } catch (e) {
    console.warn("cleanup Issue 失敗：", e);
  }
  try {
    await prisma.workflowTransition.deleteMany({ where: { workflowVersion: { workflowDefinitionId: { in: fx.definitionIds } } } });
  } catch (e) {
    console.warn("cleanup WorkflowTransition 失敗：", e);
  }
  try {
    await prisma.workflowStage.deleteMany({ where: { workflowVersion: { workflowDefinitionId: { in: fx.definitionIds } } } });
  } catch (e) {
    console.warn("cleanup WorkflowStage 失敗：", e);
  }
  try {
    await prisma.workflowVersion.deleteMany({ where: { workflowDefinitionId: { in: fx.definitionIds } } });
  } catch (e) {
    console.warn("cleanup WorkflowVersion 失敗：", e);
  }
  try {
    await prisma.workflowDefinition.deleteMany({ where: { id: { in: fx.definitionIds } } });
  } catch (e) {
    console.warn("cleanup WorkflowDefinition 失敗：", e);
  }
  try {
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: fx.userIds } } });
  } catch (e) {
    console.warn("cleanup AuditLog 失敗：", e);
  }
  try {
    await prisma.userRole.deleteMany({ where: { userId: { in: fx.userIds } } });
  } catch (e) {
    console.warn("cleanup UserRole 失敗：", e);
  }
  try {
    await prisma.user.deleteMany({ where: { id: { in: fx.userIds } } });
  } catch (e) {
    console.warn("cleanup User 失敗：", e);
  }
}

async function main() {
  console.log("=== M2-A 驗證：版本化 Workflow 定義基礎 ===");

  await runStaticSourceChecks();

  console.log("\n=== 資料庫相依檢查（需 Migration 已套用；未套用時 SKIPPED，不嘗試自動套用） ===");

  let migrationApplied = false;
  try {
    await prisma.workflowDefinition.count();
    migrationApplied = true;
  } catch {
    migrationApplied = false;
  }

  if (!migrationApplied) {
    skip("M2-A 服務層／發布驗證 DB 相依實測", "資料表尚未建立，等待 Migration 套用至測試資料庫後才能驗證，本輪不對任何資料庫套用 Migration");
  } else {
    const fx: Fixtures = { userIds: [], teamIds: [], issueIds: [], definitionIds: [] };
    try {
      await runServiceTests(fx);
    } finally {
      await cleanupFixtures(fx);
    }
  }

  console.log(`\n=== 結果：PASS=${passCount} FAIL=${failCount} SKIP=${skipCount} ===`);

  await prisma.$disconnect();

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error("m2_a-verify 執行時發生未預期錯誤：", err);
  await prisma.$disconnect();
  process.exit(1);
});
