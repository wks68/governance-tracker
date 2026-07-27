// Hotfix 操作畫面收斂驗證腳本。
//
// 涵蓋範圍（對應本輪驗收清單，至少 18 項）：
//   A. 原始碼層級靜態檢查：正式畫面不得出現「推進至下一關卡」「返回上一關」等技術詞彙、
//      transitionCopy 對照表不得出現技術詞彙、UI 元件不得直接 import Prisma、CANCEL 動作
//      必須帶雙重確認、桌面進度條不得使用水平捲動、模組邊界（hotfix-ui 一律單向依賴
//      workflow-execution，不得反向）。
//   B. DB 整合測試（真正透過執行引擎推進 Issue，非直接寫 raw row）：角色別可見性分離
//      （RD 執行人／RD 主管、QA 執行人／QA 放行人、OP 執行人／OP 主管）、退回動作明確
//      顯示目標關卡、待完成事項使用可讀欄位標籤（非技術 key）、已結案 Issue 無可執行動作、
//      Service 層對「非目前責任角色」的核准決策仍會現場拒絕（deny-by-default）、無
//      issue.view 能力者查詢一律拒絕。
//
// Fail-closed：第一行 import 為 assertSafeTestDatabase，拒絕連線到正式 prisma/dev.db。
//
// 執行方式（DATABASE_URL 指向的檔案必須已存在，腳本本身會對它執行一次
// `prisma migrate deploy`）：
//   touch /path/to/scratch.db
//   DATABASE_URL="file:/path/to/scratch.db" node_modules/.bin/tsx scripts/hotfix_ui-verify.ts

import "./lib/assertSafeTestDatabase";

import * as fs from "node:fs";
import * as path from "node:path";
import { prisma } from "../src/lib/prisma";
import { buildHotfixWorkflowV1 } from "./lib/buildHotfixWorkflowV1";
import {
  startIssueWorkflow,
  executeIssueTransition,
  returnIssueToStage,
  setIssueAssignedTeamAtTriage,
  submitStageRiskCheckAnswer,
  getIssueWorkflowRuntime,
  WorkflowExecutionAccessDeniedError,
} from "../src/lib/workflowExecutionService";
import { decideApprovalRecord, ApprovalAuthorityMismatchError } from "../src/lib/approvalService";
import { SelfApprovalError } from "../src/lib/permissions";
import { buildHotfixRuntimeView } from "../src/lib/hotfix-ui/runtimeView";
import { transitionCopyOf } from "../src/lib/hotfix-ui/transitionCopy";

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

const REPO_ROOT = path.resolve(__dirname, "..");
const RUN_TAG = `hfv${Date.now()}`;

function listFilesRecursive(dir: string, extensions: string[]): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (extensions.some((ext) => entry.name.endsWith(ext))) results.push(full);
    }
  };
  walk(dir);
  return results;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

// =====================================================================================
// A. 原始碼層級靜態檢查
// =====================================================================================
function runStaticSourceChecks() {
  console.log("\n=== A. 原始碼層級靜態檢查 ===");

  const hotfixUiComponentFiles = listFilesRecursive(path.join(REPO_ROOT, "src/components/hotfix-execution"), [".ts", ".tsx"]);
  const hotfixUiLibFiles = listFilesRecursive(path.join(REPO_ROOT, "src/lib/hotfix-ui"), [".ts", ".tsx"]);
  check("[1] Hotfix 操作畫面元件檔案確實存在（非空殼）", hotfixUiComponentFiles.length >= 6);

  // [2] 正式畫面（元件層）不得出現「推進至下一關卡」「返回上一關」等技術詞彙
  let forbiddenCopyViolation: string | null = null;
  for (const file of hotfixUiComponentFiles) {
    const src = stripComments(fs.readFileSync(file, "utf8"));
    if (/推進至下一關卡|返回上一關/.test(src)) {
      forbiddenCopyViolation = path.relative(REPO_ROOT, file);
      break;
    }
  }
  check("[2] 元件層（src/components/hotfix-execution）不出現「推進至下一關卡」「返回上一關」字樣", forbiddenCopyViolation === null, forbiddenCopyViolation ?? undefined);

  // [3] transitionCopy 對照表本身不得出現技術詞彙／FORWARD／RETURN／CANCEL 當作顯示文案
  const transitionCopySrc = stripComments(fs.readFileSync(path.join(REPO_ROOT, "src/lib/hotfix-ui/transitionCopy.ts"), "utf8"));
  const copyLabelMatches = [...transitionCopySrc.matchAll(/label:\s*"([^"]*)"/g)].map((m) => m[1]);
  const hasForbiddenLabel = copyLabelMatches.some((label) => /推進至下一關卡|返回上一關|FORWARD|RETURN|CANCEL/.test(label));
  check("[3] transitionCopy.ts 對照表本身沒有任何顯示文案含技術詞彙（推進至下一關卡／返回上一關／FORWARD／RETURN／CANCEL）", !hasForbiddenLabel && copyLabelMatches.length >= 20);

  // [4] UI 元件層不得直接 import Prisma（比照治理儀表板既有規範）
  let prismaImportViolation: string | null = null;
  for (const file of hotfixUiComponentFiles) {
    const src = fs.readFileSync(file, "utf8");
    if (/@prisma\/client/.test(src) || /from\s*["']@\/lib\/prisma["']/.test(src) || /from\s*["']\.\.\/\.\.\/lib\/prisma["']/.test(src)) {
      prismaImportViolation = path.relative(REPO_ROOT, file);
      break;
    }
  }
  check("[4] src/components/hotfix-execution 沒有任何檔案直接 import Prisma", prismaImportViolation === null, prismaImportViolation ?? undefined);

  // [5] CANCEL 動作必須帶雙重確認（TransitionActionForm 的 confirmMessage）
  const actionPanelsSrc = fs.readFileSync(path.join(REPO_ROOT, "src/components/hotfix-execution/HotfixActionPanels.tsx"), "utf8");
  const cancelActionsBlock = actionPanelsSrc.slice(actionPanelsSrc.indexOf("function CancelActions"));
  check("[5] 取消 Hotfix 動作元件（CancelActions）傳入 confirmMessage（雙重確認）", /confirmMessage=/.test(cancelActionsBlock));

  // [6] 桌面進度條不得使用水平捲動（採 CSS grid 等分排列，不使用 overflow-x-auto／flex-nowrap）
  const statusHeaderSrc = fs.readFileSync(path.join(REPO_ROOT, "src/components/hotfix-execution/HotfixStatusHeader.tsx"), "utf8");
  check(
    "[6] HotfixStatusHeader 進度條使用 grid-cols-7 等分排列，不使用 overflow-x-auto／flex-nowrap（無水平捲動）",
    /grid-cols-7/.test(statusHeaderSrc) && !/overflow-x-auto/.test(statusHeaderSrc) && !/flex-nowrap/.test(statusHeaderSrc),
  );

  // [7] 模組邊界：workflow-execution 一律不得反向 import hotfix-ui（單向依賴）
  const workflowExecutionFiles = listFilesRecursive(path.join(REPO_ROOT, "src/lib/workflow-execution"), [".ts"]);
  let reverseImportViolation: string | null = null;
  for (const file of workflowExecutionFiles) {
    const src = fs.readFileSync(file, "utf8");
    if (/from\s*["'].*hotfix-ui/.test(src)) {
      reverseImportViolation = path.relative(REPO_ROOT, file);
      break;
    }
  }
  check("[7] src/lib/workflow-execution 沒有任何檔案反向 import src/lib/hotfix-ui（模組邊界單向）", reverseImportViolation === null, reverseImportViolation ?? undefined);

  // [8] hotfix-ui 模組不直接 import issueCreation／既有 legacy Server Action 模組（不破壞既有邊界）
  let crossBoundaryViolation: string | null = null;
  for (const file of hotfixUiLibFiles) {
    const src = fs.readFileSync(file, "utf8");
    if (/from\s*["'].*\/lib\/actions["']/.test(src) || /from\s*["'].*app\/issues\/new/.test(src)) {
      crossBoundaryViolation = path.relative(REPO_ROOT, file);
      break;
    }
  }
  check("[8] src/lib/hotfix-ui 沒有任何檔案 import 既有 issue 建立（src/lib/actions／issues/new）模組", crossBoundaryViolation === null, crossBoundaryViolation ?? undefined);

  // [9] 目前待完成事項不得顯示技術詞彙（gate／requirement／技術 field key／「關卡卡控未通過」）
  const runtimeViewSrc = stripComments(fs.readFileSync(path.join(REPO_ROOT, "src/lib/hotfix-ui/runtimeView.ts"), "utf8"));
  check("[9] runtimeView.ts 產生的待完成事項文字不出現「關卡卡控未通過」字樣", !/關卡卡控未通過/.test(runtimeViewSrc));

  // [10] /governance 於核准／風險檢核操作後會重新驗證（revalidatePath("/governance")）
  const actionsSrc = fs.readFileSync(path.join(REPO_ROOT, "src/app/issues/[id]/workflow-execution-actions.ts"), "utf8");
  check('[10] workflow-execution-actions.ts 的 revalidateIssue 會 revalidatePath("/governance")', /revalidatePath\(["']\/governance["']\)/.test(actionsSrc));

  // [11] 空資料狀態：風險檢核與待完成事項元件皆有明確的空狀態文字（非技術詞彙的預設訊息）
  const riskPanelSrc = fs.readFileSync(path.join(REPO_ROOT, "src/components/hotfix-execution/HotfixRiskCheckPanel.tsx"), "utf8");
  const todoListSrc = fs.readFileSync(path.join(REPO_ROOT, "src/components/hotfix-execution/HotfixTodoList.tsx"), "utf8");
  check(
    "[11] HotfixRiskCheckPanel／HotfixTodoList 皆有明確空狀態文字",
    /此階段沒有設定風險確認項目/.test(riskPanelSrc) && /目前沒有待完成事項/.test(todoListSrc),
  );
}

// =====================================================================================
// B. DB 整合測試（真正透過執行引擎推進 Issue）
// =====================================================================================

async function createUser(name: string, role: string) {
  const user = await prisma.user.create({ data: { name: `${RUN_TAG}-${name}`, email: `${RUN_TAG}-${name}@example.invalid`, role, isActive: true } });
  await prisma.userRole.create({ data: { userId: user.id, role, isActive: true } });
  return user;
}
async function createTeam(name: string) {
  return prisma.team.create({ data: { name: `${RUN_TAG}-${name}` } });
}
async function addMember(teamId: string, userId: string, membershipRole: "MEMBER" | "LEAD") {
  await prisma.teamMember.create({ data: { teamId, userId, membershipRole, isActive: true } });
}
async function findTransition(workflowVersionId: string, fromStageId: string, actionKey: string) {
  const t = await prisma.workflowTransition.findFirst({ where: { workflowVersionId, fromStageId, actionKey } });
  if (!t) throw new Error(`找不到 Transition（fromStageId=${fromStageId}, actionKey=${actionKey}）`);
  return t;
}
async function findActiveApproval(issueId: string, approvalType: string, relatedStageKey: string) {
  const r = await prisma.approvalRecord.findFirst({ where: { issueId, approvalType, relatedStageKey, recordStatus: "ACTIVE" }, orderBy: { revisionNo: "desc" } });
  if (!r) throw new Error(`找不到 ApprovalRecord（${approvalType}/${relatedStageKey}）`);
  return r;
}
async function answerAll(issueId: string, stageKey: string, actorId: string) {
  const { getRiskCheckTemplate } = await import("../src/lib/riskCheckTemplates");
  const template = getRiskCheckTemplate(stageKey)!;
  for (const item of template) {
    await submitStageRiskCheckAnswer({ issueId, stageKey, checkKey: item.checkKey, answer: "NO", actorId });
  }
}

async function runDbIntegrationChecks() {
  console.log("\n=== B. DB 整合測試（真正透過執行引擎推進 Issue） ===");

  const admin = await createUser("Admin", "Admin");
  const pm = await createUser("PM", "PM");
  const supervisor = await createUser("Supervisor", "DMS主管");
  await prisma.userSupervisorAssignment.create({
    data: { userId: pm.id, supervisorUserId: supervisor.id, validFrom: new Date(Date.now() - 86_400_000), isPrimary: true, isActive: true, createdByUserId: admin.id },
  });
  const rdTeam = await createTeam("RdTeam");
  const rdMember = await createUser("RdMember", "RD");
  const rdLead = await createUser("RdLead", "RD");
  await addMember(rdTeam.id, rdMember.id, "MEMBER");
  await addMember(rdTeam.id, rdLead.id, "LEAD");
  const qaTeam = await createTeam("QaTeam");
  const qaMember = await createUser("QaMember", "QA");
  const qaLead = await createUser("QaLead", "QA");
  await addMember(qaTeam.id, qaMember.id, "MEMBER");
  await addMember(qaTeam.id, qaLead.id, "LEAD");
  const opTeam = await createTeam("OpTeam");
  const opMember = await createUser("OpMember", "OP");
  const opLead = await createUser("OpLead", "OP");
  await addMember(opTeam.id, opMember.id, "MEMBER");
  await addMember(opTeam.id, opLead.id, "LEAD");
  const outsider = await createUser("Outsider", "PM");

  const hotfix = await buildHotfixWorkflowV1({ actorId: admin.id, reasonCode: "VERIFY_BUILD_HOTFIX_V1", keySuffix: RUN_TAG });
  const s = hotfix.stageIds;

  // [12] transitionCopy 涵蓋 Hotfix v1 全部真實 actionKey（不落回 fallback 原始 label）
  const allTransitions = await prisma.workflowTransition.findMany({ where: { workflowVersionId: hotfix.version.id } });
  const uncoveredActionKeys = allTransitions.filter((t) => transitionCopyOf(t.actionKey, "__FALLBACK_MARKER__").label === "__FALLBACK_MARKER__").map((t) => t.actionKey);
  check("[12] transitionCopy.ts 涵蓋 Hotfix v1 全部真實 actionKey", uncoveredActionKeys.length === 0, uncoveredActionKeys.join(", ") || undefined);

  async function createIssue(key: string) {
    const issue = await prisma.issue.create({ data: { issueKey: `${RUN_TAG}-${key}`, issueType: "Hotfix", title: `驗證案件 ${key}`, workflowStatus: "n/a" } });
    await startIssueWorkflow({ issueId: issue.id, workflowVersionId: hotfix.version.id, actorId: admin.id, reasonCode: "VERIFY_START" });
    return issue;
  }

  // 推進至 pendingRdLeadApproval（RD 自測／待 RD 主管核准）
  const rdCase = await createIssue("RD");
  {
    const t0 = await findTransition(hotfix.version.id, s.draft, "submit");
    await executeIssueTransition({ issueId: rdCase.id, transitionId: t0.id, actorId: pm.id, reasonCode: "V" });
    const approval0 = await findActiveApproval(rdCase.id, "BUSINESS_APPROVAL", "pendingBusinessApproval");
    await decideApprovalRecord({ approvalRecordId: approval0.id, actorUserId: supervisor.id, decision: "APPROVED" });
    const t1 = await findTransition(hotfix.version.id, s.pendingBusinessApproval, "businessApprove");
    await executeIssueTransition({ issueId: rdCase.id, transitionId: t1.id, actorId: pm.id, reasonCode: "V" });
    await setIssueAssignedTeamAtTriage({ issueId: rdCase.id, teamId: rdTeam.id, actorId: admin.id, reasonCode: "V" });
    const t2 = await findTransition(hotfix.version.id, s.pendingRdTriage, "rdAssign");
    await executeIssueTransition({ issueId: rdCase.id, transitionId: t2.id, actorId: admin.id, reasonCode: "V" });
    const t3 = await findTransition(hotfix.version.id, s.pendingRdClaim, "rdClaim");
    await executeIssueTransition({ issueId: rdCase.id, transitionId: t3.id, actorId: rdMember.id, reasonCode: "V" });
    await prisma.issueFieldValue.create({ data: { issueId: rdCase.id, fieldKey: "rdFixVersion", fieldLabel: "修正版本", fieldValue: "v1" } });
    await answerAll(rdCase.id, "pendingRdLeadApproval", rdMember.id);
    const t4 = await findTransition(hotfix.version.id, s.rdInProgress, "rdSubmit");
    await executeIssueTransition({ issueId: rdCase.id, transitionId: t4.id, actorId: rdMember.id, reasonCode: "V" });
  }

  const runtimeAtRdLeadApproval = await getIssueWorkflowRuntime(rdCase.id, admin.id);
  if (!runtimeAtRdLeadApproval.onVersionedWorkflow) throw new Error("預期案件已在新版 Workflow 上");

  const buildView = (actorId: string) =>
    buildHotfixRuntimeView({
      issueId: rdCase.id,
      actorId,
      currentStage: {
        stageKey: runtimeAtRdLeadApproval.currentStage.stageKey,
        label: runtimeAtRdLeadApproval.currentStage.label,
        stageType: runtimeAtRdLeadApproval.currentStage.stageType,
        requiredMembershipRole: runtimeAtRdLeadApproval.currentStage.requiredMembershipRole,
      },
      assignedTeamId: rdTeam.id,
      assignedTeamName: rdTeam.name,
      availableTransitions: runtimeAtRdLeadApproval.availableTransitions,
      stageRequirements: runtimeAtRdLeadApproval.stageRequirements,
      pendingApprovalDecision: runtimeAtRdLeadApproval.pendingApproval?.decision === "PENDING" ? "PENDING" : null,
      pendingApprovalExpectedApproverUserId: runtimeAtRdLeadApproval.pendingApproval?.expectedApproverUserId ?? null,
    });

  await checkAsync("[13] RD 執行人在「待 RD 主管核准」關卡不是目前責任角色（不可見核准動作）", async () => !(await buildView(rdMember.id)).isCurrentActorResponsible);
  await checkAsync("[14] RD 主管在「待 RD 主管核准」關卡是目前責任角色（可核准／退回）", async () => (await buildView(rdLead.id)).isCurrentActorResponsible);
  await checkAsync("[15] 角色標籤於核准關卡正確顯示主管視角（「RD 主管」而非「RD 執行人」）", async () => (await buildView(rdLead.id)).responsibleRoleLabel === "RD 主管");

  // [16] Service 層對「非目前責任角色」的核准決策仍會現場拒絕（deny-by-default，不信任 UI 判斷）
  const approvalRecord = await findActiveApproval(rdCase.id, "RD_LEAD_APPROVAL", "pendingRdLeadApproval");
  await expectError(
    "[16] decideApprovalRecord 拒絕非合法核准人（QA 執行人，與此核准無關）冒名核准，即使 UI 隱藏了按鈕",
    () => decideApprovalRecord({ approvalRecordId: approvalRecord.id, actorUserId: qaMember.id, decision: "APPROVED" }),
    (err) => err instanceof ApprovalAuthorityMismatchError,
  );
  await expectError(
    "[16b] decideApprovalRecord 拒絕完全無關人員（outsider）核准",
    () => decideApprovalRecord({ approvalRecordId: approvalRecord.id, actorUserId: outsider.id, decision: "APPROVED" }),
    (err) => err instanceof ApprovalAuthorityMismatchError,
  );
  await expectError(
    "[16c] decideApprovalRecord 拒絕送核人本人自行核准（即使該送核人具備 RD 團隊身分）",
    () => decideApprovalRecord({ approvalRecordId: approvalRecord.id, actorUserId: rdMember.id, decision: "APPROVED" }),
    (err) => err instanceof SelfApprovalError,
  );

  // [17] 待完成事項使用可讀欄位標籤，不是技術 field key
  const rdMemberInProgressView = await buildHotfixRuntimeView({
    issueId: rdCase.id,
    actorId: rdMember.id,
    currentStage: {
      stageKey: runtimeAtRdLeadApproval.currentStage.stageKey,
      label: runtimeAtRdLeadApproval.currentStage.label,
      stageType: runtimeAtRdLeadApproval.currentStage.stageType,
      requiredMembershipRole: runtimeAtRdLeadApproval.currentStage.requiredMembershipRole,
    },
    assignedTeamId: rdTeam.id,
    assignedTeamName: rdTeam.name,
    availableTransitions: runtimeAtRdLeadApproval.availableTransitions,
    stageRequirements: runtimeAtRdLeadApproval.stageRequirements,
    pendingApprovalDecision: "PENDING",
    pendingApprovalExpectedApproverUserId: null,
  });
  check(
    "[17] 待完成事項提及「RD 主管核准」而非技術 stageKey／requirement type",
    rdMemberInProgressView.todoItems.some((t) => t.text.includes("RD 主管核准")) && !rdMemberInProgressView.todoItems.some((t) => /pendingRdLeadApproval|REQUIRE_FIELD/.test(t.text)),
  );

  // 完成 RD 主管核准，推進至 QA，驗證 QA 執行人／QA 放行人分離
  await decideApprovalRecord({ approvalRecordId: approvalRecord.id, actorUserId: rdLead.id, decision: "APPROVED" });
  const rdApproveT = await findTransition(hotfix.version.id, s.pendingRdLeadApproval, "rdLeadApprove");
  await executeIssueTransition({ issueId: rdCase.id, transitionId: rdApproveT.id, actorId: rdLead.id, reasonCode: "V" });
  await setIssueAssignedTeamAtTriage({ issueId: rdCase.id, teamId: qaTeam.id, actorId: admin.id, reasonCode: "V" });
  const qaAssignT = await findTransition(hotfix.version.id, s.pendingQaTriage, "qaAssign");
  await executeIssueTransition({ issueId: rdCase.id, transitionId: qaAssignT.id, actorId: admin.id, reasonCode: "V" });
  const qaClaimT = await findTransition(hotfix.version.id, s.pendingQaClaim, "qaClaim");
  await executeIssueTransition({ issueId: rdCase.id, transitionId: qaClaimT.id, actorId: qaMember.id, reasonCode: "V" });
  await prisma.issueFieldValue.create({ data: { issueId: rdCase.id, fieldKey: "qaTestResult", fieldLabel: "QA 測試結果", fieldValue: "通過" } });
  await answerAll(rdCase.id, "pendingQaLeadApproval", qaMember.id);
  const qaSubmitT = await findTransition(hotfix.version.id, s.qaInProgress, "qaSubmit");
  await executeIssueTransition({ issueId: rdCase.id, transitionId: qaSubmitT.id, actorId: qaMember.id, reasonCode: "V" });

  const runtimeAtQaLeadApproval = await getIssueWorkflowRuntime(rdCase.id, admin.id);
  if (!runtimeAtQaLeadApproval.onVersionedWorkflow) throw new Error("預期案件已在新版 Workflow 上");
  const buildQaView = (actorId: string) =>
    buildHotfixRuntimeView({
      issueId: rdCase.id,
      actorId,
      currentStage: {
        stageKey: runtimeAtQaLeadApproval.currentStage.stageKey,
        label: runtimeAtQaLeadApproval.currentStage.label,
        stageType: runtimeAtQaLeadApproval.currentStage.stageType,
        requiredMembershipRole: runtimeAtQaLeadApproval.currentStage.requiredMembershipRole,
      },
      assignedTeamId: qaTeam.id,
      assignedTeamName: qaTeam.name,
      availableTransitions: runtimeAtQaLeadApproval.availableTransitions,
      stageRequirements: runtimeAtQaLeadApproval.stageRequirements,
      pendingApprovalDecision: runtimeAtQaLeadApproval.pendingApproval?.decision === "PENDING" ? "PENDING" : null,
      pendingApprovalExpectedApproverUserId: runtimeAtQaLeadApproval.pendingApproval?.expectedApproverUserId ?? null,
    });
  await checkAsync("[18] QA 執行人在「待 QA 主管核准」關卡不是目前責任角色（QA 執行人／QA 放行人分離）", async () => !(await buildQaView(qaMember.id)).isCurrentActorResponsible);
  await checkAsync("[19] QA 主管（放行人）在「待 QA 主管核准」關卡是目前責任角色", async () => (await buildQaView(qaLead.id)).isCurrentActorResponsible);

  // 完成 QA 放行，推進至 OP，驗證 OP 執行人／OP 主管分離
  const qaApproval = await findActiveApproval(rdCase.id, "QA_LEAD_APPROVAL", "pendingQaLeadApproval");
  await decideApprovalRecord({ approvalRecordId: qaApproval.id, actorUserId: qaLead.id, decision: "APPROVED" });
  const qaApproveT = await findTransition(hotfix.version.id, s.pendingQaLeadApproval, "qaLeadApprove");
  await executeIssueTransition({ issueId: rdCase.id, transitionId: qaApproveT.id, actorId: qaLead.id, reasonCode: "V" });
  await setIssueAssignedTeamAtTriage({ issueId: rdCase.id, teamId: opTeam.id, actorId: admin.id, reasonCode: "V" });
  const opAssignT = await findTransition(hotfix.version.id, s.pendingOpTriage, "opAssign");
  await executeIssueTransition({ issueId: rdCase.id, transitionId: opAssignT.id, actorId: admin.id, reasonCode: "V" });
  const opClaimT = await findTransition(hotfix.version.id, s.pendingOpClaim, "opClaim");
  await executeIssueTransition({ issueId: rdCase.id, transitionId: opClaimT.id, actorId: opMember.id, reasonCode: "V" });
  await prisma.evidence.create({ data: { issueId: rdCase.id, type: "Log", title: "部署檢查", url: "http://example.invalid/x" } });
  await answerAll(rdCase.id, "pendingDeploymentApproval", opMember.id);
  const opSubmitT = await findTransition(hotfix.version.id, s.opPreparing, "opSubmit");
  await executeIssueTransition({ issueId: rdCase.id, transitionId: opSubmitT.id, actorId: opMember.id, reasonCode: "V" });

  const runtimeAtDeployApproval = await getIssueWorkflowRuntime(rdCase.id, admin.id);
  if (!runtimeAtDeployApproval.onVersionedWorkflow) throw new Error("預期案件已在新版 Workflow 上");
  const buildOpView = (actorId: string) =>
    buildHotfixRuntimeView({
      issueId: rdCase.id,
      actorId,
      currentStage: {
        stageKey: runtimeAtDeployApproval.currentStage.stageKey,
        label: runtimeAtDeployApproval.currentStage.label,
        stageType: runtimeAtDeployApproval.currentStage.stageType,
        requiredMembershipRole: runtimeAtDeployApproval.currentStage.requiredMembershipRole,
      },
      assignedTeamId: opTeam.id,
      assignedTeamName: opTeam.name,
      availableTransitions: runtimeAtDeployApproval.availableTransitions,
      stageRequirements: runtimeAtDeployApproval.stageRequirements,
      pendingApprovalDecision: runtimeAtDeployApproval.pendingApproval?.decision === "PENDING" ? "PENDING" : null,
      pendingApprovalExpectedApproverUserId: runtimeAtDeployApproval.pendingApproval?.expectedApproverUserId ?? null,
    });
  await checkAsync("[20] OP 執行人在「待部署核准」關卡不是目前責任角色（OP 執行人／OP 主管分離）", async () => !(await buildOpView(opMember.id)).isCurrentActorResponsible);
  await checkAsync("[21] OP 主管在「待部署核准」關卡是目前責任角色", async () => (await buildOpView(opLead.id)).isCurrentActorResponsible);

  // [22] RETURN 明確顯示退回目標關卡
  const rejectT = await findTransition(hotfix.version.id, s.pendingRdLeadApproval, "rdLeadReject");
  const returnCase = await createIssue("RETURN");
  {
    const t0 = await findTransition(hotfix.version.id, s.draft, "submit");
    await executeIssueTransition({ issueId: returnCase.id, transitionId: t0.id, actorId: pm.id, reasonCode: "V" });
    const approval0 = await findActiveApproval(returnCase.id, "BUSINESS_APPROVAL", "pendingBusinessApproval");
    await decideApprovalRecord({ approvalRecordId: approval0.id, actorUserId: supervisor.id, decision: "APPROVED" });
    const t1 = await findTransition(hotfix.version.id, s.pendingBusinessApproval, "businessApprove");
    await executeIssueTransition({ issueId: returnCase.id, transitionId: t1.id, actorId: pm.id, reasonCode: "V" });
    await setIssueAssignedTeamAtTriage({ issueId: returnCase.id, teamId: rdTeam.id, actorId: admin.id, reasonCode: "V" });
    const t2 = await findTransition(hotfix.version.id, s.pendingRdTriage, "rdAssign");
    await executeIssueTransition({ issueId: returnCase.id, transitionId: t2.id, actorId: admin.id, reasonCode: "V" });
    const t3 = await findTransition(hotfix.version.id, s.pendingRdClaim, "rdClaim");
    await executeIssueTransition({ issueId: returnCase.id, transitionId: t3.id, actorId: rdMember.id, reasonCode: "V" });
    await prisma.issueFieldValue.create({ data: { issueId: returnCase.id, fieldKey: "rdFixVersion", fieldLabel: "修正版本", fieldValue: "v1" } });
    await answerAll(returnCase.id, "pendingRdLeadApproval", rdMember.id);
    const t4 = await findTransition(hotfix.version.id, s.rdInProgress, "rdSubmit");
    await executeIssueTransition({ issueId: returnCase.id, transitionId: t4.id, actorId: rdMember.id, reasonCode: "V" });
    const returnApproval = await findActiveApproval(returnCase.id, "RD_LEAD_APPROVAL", "pendingRdLeadApproval");
    await decideApprovalRecord({ approvalRecordId: returnApproval.id, actorUserId: rdLead.id, decision: "REJECTED", decisionReasonCode: "NEEDS_WORK" });
    await returnIssueToStage({ issueId: returnCase.id, transitionId: rejectT.id, actorId: rdLead.id, reasonCode: "NEEDS_WORK" });
  }
  const returnHistory = await prisma.issueWorkflowStageHistory.findMany({ where: { issueId: returnCase.id, transitionType: "RETURNED" }, include: { toStage: true, fromStage: true } });
  check(
    "[22] 退回歷程明確記錄目標關卡（fromStage=待 RD 主管核准 → toStage=RD 修正中）",
    returnHistory.length === 1 && returnHistory[0].fromStage?.label === "待 RD 主管核准" && returnHistory[0].toStage.label === "RD 修正中",
  );

  // [23] 已終結（取消）Issue 沒有任何可執行的前進動作（不可再操作）——以 cancelDraft
  // 走最短路徑驗證「已終結案件」的通用行為即可，不需要真的走完整 20 關卡到 closed。
  const cancelledCase = await createIssue("CANCELLED");
  const cancelDraftT = await findTransition(hotfix.version.id, s.draft, "cancelDraft");
  const { cancelIssueWorkflow } = await import("../src/lib/workflowExecutionService");
  await cancelIssueWorkflow({ issueId: cancelledCase.id, transitionId: cancelDraftT.id, actorId: admin.id, reasonCode: "V" });
  const cancelledRuntime = await getIssueWorkflowRuntime(cancelledCase.id, admin.id);
  check(
    "[23] 已取消 Issue 沒有任何可執行的 FORWARD／RETURN 動作（不可再操作）",
    cancelledRuntime.onVersionedWorkflow && cancelledRuntime.availableTransitions.filter((t) => t.transition.transitionType !== "CANCEL").length === 0,
  );

  // [24] 無 issue.view 能力者查詢 Workflow Runtime 一律拒絕（含空資料／無權限情境）
  const inactiveUser = await prisma.user.create({ data: { name: `${RUN_TAG}-Inactive`, email: `${RUN_TAG}-inactive@example.invalid`, role: "PM", isActive: false } });
  await expectError(
    "[24] 停用帳號（無 issue.view 能力）查詢 Workflow Runtime 一律拒絕",
    () => getIssueWorkflowRuntime(rdCase.id, inactiveUser.id),
    (err) => err instanceof WorkflowExecutionAccessDeniedError,
  );

  console.log("\n=== 清理測試 Fixture ===");
  const fixtureIssueIds = (await prisma.issue.findMany({ where: { issueKey: { startsWith: `${RUN_TAG}-` } }, select: { id: true } })).map((i) => i.id);
  await prisma.stageRiskCheck.deleteMany({ where: { issueId: { in: fixtureIssueIds } } });
  await prisma.approvalRecord.deleteMany({ where: { issueId: { in: fixtureIssueIds } } });
  await prisma.issueFieldValue.deleteMany({ where: { issueId: { in: fixtureIssueIds } } });
  await prisma.evidence.deleteMany({ where: { issueId: { in: fixtureIssueIds } } });
  await prisma.issueWorkflowStageHistory.deleteMany({ where: { issueId: { in: fixtureIssueIds } } });
  await prisma.issue.deleteMany({ where: { id: { in: fixtureIssueIds } } });
  const fixtureStageIds = (await prisma.workflowStage.findMany({ where: { workflowVersionId: hotfix.version.id }, select: { id: true } })).map((s) => s.id);
  await prisma.workflowStageRequirement.deleteMany({ where: { workflowStageId: { in: fixtureStageIds } } });
  await prisma.workflowTransition.deleteMany({ where: { workflowVersionId: hotfix.version.id } });
  await prisma.workflowStage.deleteMany({ where: { workflowVersionId: hotfix.version.id } });
  await prisma.workflowVersion.deleteMany({ where: { id: hotfix.version.id } });
  await prisma.workflowDefinition.deleteMany({ where: { id: hotfix.version.workflowDefinitionId } });
  await prisma.teamMember.deleteMany({ where: { teamId: { in: [rdTeam.id, qaTeam.id, opTeam.id] } } });
  await prisma.team.deleteMany({ where: { id: { in: [rdTeam.id, qaTeam.id, opTeam.id] } } });
  await prisma.userSupervisorAssignment.deleteMany({ where: { userId: pm.id } });
  await prisma.userRole.deleteMany({ where: { userId: { in: [admin.id, pm.id, supervisor.id, rdMember.id, rdLead.id, qaMember.id, qaLead.id, opMember.id, opLead.id, outsider.id, inactiveUser.id] } } });
  await prisma.user.deleteMany({ where: { id: { in: [admin.id, pm.id, supervisor.id, rdMember.id, rdLead.id, qaMember.id, qaLead.id, opMember.id, opLead.id, outsider.id, inactiveUser.id] } } });
}

async function main() {
  runStaticSourceChecks();
  await runDbIntegrationChecks();

  console.log(`\n=== 結果：PASS=${passCount} FAIL=${failCount} SKIP=${skipCount} ===`);
  if (failCount > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("執行 Hotfix UI 驗證腳本時發生未預期錯誤：", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
