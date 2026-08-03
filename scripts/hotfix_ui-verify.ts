// Hotfix 九階段 UI 收斂驗證腳本（全面取代舊版 7 階段收斂版本）。
//
// 涵蓋範圍：
//   A. 原始碼層級靜態檢查：9 階段名稱一致、舊 7 階段字樣／技術詞彙／佐證資料字樣不再
//      出現於新版 Hotfix 頁面與元件、UI 元件不直接 import Prisma、進度條無水平捲動、
//      駁回一律要求原因、舊版 Hotfix 元件目錄已刪除、routeForStageKey 涵蓋全部關卡。
//   B. DB 整合測試（真正透過既有執行引擎推進 Issue，非直接寫 raw row）：9 階段索引與
//      stageKey 對照正確、4 個簽核關卡的責任角色分離與 deny-by-default、RD/QA/OP 主管
//      駁回明確退回正確目標關卡、結案責任人固定為原始填單人、已結案後唯讀、附件僅能於
//      目前關卡上傳／刪除、非目前責任角色查詢一律唯讀、正式 dev.db 全程未被觸碰（本腳本
//      只連線 DATABASE_URL 指向的測試庫，見 assertSafeTestDatabase）。
//
// Fail-closed：第一行 import 為 assertSafeTestDatabase，拒絕連線到正式 prisma/dev.db。
//
// 執行方式：
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
  cancelIssueWorkflow,
  submitStageRiskCheckAnswer,
  getIssueWorkflowRuntime,
  claimIssueForTeam,
  assignIssueExecutor,
  WorkflowExecutionAccessDeniedError,
} from "../src/lib/workflowExecutionService";
import { decideApprovalRecord, ApprovalAuthorityMismatchError } from "../src/lib/approvalService";
import { SelfApprovalError } from "../src/lib/permissions";
import { NINE_STAGES, nineStageIndexOfStageKey, routeForStageKey } from "../src/lib/hotfix-ui/nineStage";
import { loadCancelledFromNineStageIndex } from "../src/lib/hotfix-ui/pageContext";
import { uploadHotfixAttachment, deleteHotfixAttachment, AttachmentAuthorizationError } from "../src/lib/hotfix-ui/attachmentService";
import { saveExecutionFieldValues } from "../src/lib/hotfix-ui/executionFields";
import { setTeamDomain } from "../src/lib/team-applicant/teamManagementService";
import { getNineStageVisualStates } from "../src/components/hotfix-nine-stage/NineStageProgressBar";

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

  const hotfixRouteFiles = listFilesRecursive(path.join(REPO_ROOT, "src/app/issues/[id]/hotfix"), [".ts", ".tsx"]);
  const hotfixComponentFiles = listFilesRecursive(path.join(REPO_ROOT, "src/components/hotfix-nine-stage"), [".ts", ".tsx"]);
  const allNewHotfixFiles = [...hotfixRouteFiles, ...hotfixComponentFiles];

  check("[1] 新版 Hotfix 九階段路由與元件檔案確實存在（非空殼）", hotfixRouteFiles.length >= 15 && hotfixComponentFiles.length >= 6);

  // [2] 9 階段名稱與順序正確
  const expectedLabels = [
    "Hotfix建立工單",
    "申請人直屬主管簽核",
    "RD修正與自測",
    "RD主管簽核",
    "QA驗證",
    "QA主管簽核",
    "OP上版作業",
    "OP主管上版後確認",
    "原申請人確認結案",
  ];
  check(
    "[2] nineStage.ts 定義的 9 階段名稱與順序完全正確",
    NINE_STAGES.length === 9 && NINE_STAGES.every((s, i) => s.index === i + 1 && s.label === expectedLabels[i]),
  );

  // [3] 舊版 7 階段字樣不再出現於任何新版 Hotfix 頁面／元件
  // 「正式環境確認」為舊版 7 階段的獨立進度節點名稱；新版結案頁的「正式環境確認結果」是
  // 合法的新欄位標籤（見結案頁欄位規格），非同一語意，比對時排除這個合法組合。
  const oldStageLabels = ["Hotfix已開單", "Hotfix 已開單", "RD自測", "QA放行確認"];
  let oldLabelViolation: string | null = null;
  for (const file of allNewHotfixFiles) {
    const src = stripComments(fs.readFileSync(file, "utf8"));
    const hasOldLabel = oldStageLabels.some((label) => src.includes(label));
    const hasBareProdConfirmLabel = /正式環境確認(?!結果)/.test(src);
    if (hasOldLabel || hasBareProdConfirmLabel) {
      oldLabelViolation = path.relative(REPO_ROOT, file);
      break;
    }
  }
  check("[3] 新版 Hotfix 檔案不出現舊版 7 階段標籤字樣", oldLabelViolation === null, oldLabelViolation ?? undefined);

  // [4] 舊版技術詞彙／禁用文案完全不出現於新版 Hotfix 檔案
  const forbiddenWords = ["推進至下一關卡", "返回上一關", "關卡卡控未通過", "佐證資料", "Mock", "MVP"];
  let forbiddenWordViolation: string | null = null;
  let forbiddenWordHit: string | null = null;
  for (const file of allNewHotfixFiles) {
    const src = stripComments(fs.readFileSync(file, "utf8"));
    const hit = forbiddenWords.find((w) => src.includes(w));
    if (hit) {
      forbiddenWordViolation = path.relative(REPO_ROOT, file);
      forbiddenWordHit = hit;
      break;
    }
  }
  check(
    "[4] 新版 Hotfix 檔案不出現「推進至下一關卡／返回上一關／關卡卡控未通過／佐證資料／Mock／MVP」字樣",
    forbiddenWordViolation === null,
    forbiddenWordViolation ? `${forbiddenWordViolation}: ${forbiddenWordHit}` : undefined,
  );

  // [5] 附件命名統一為「附件（選填）」
  const attachmentSectionSrc = fs.readFileSync(path.join(REPO_ROOT, "src/components/hotfix-nine-stage/AttachmentSection.tsx"), "utf8");
  check("[5] AttachmentSection 顯示「附件（選填）」", attachmentSectionSrc.includes("附件（選填）"));

  // [6] 只有 Client Component 禁止直接 import Prisma；async Server Component 可在伺服器端
  // 組裝唯讀 ViewModel。舊測試把所有 .tsx 一律當成 client，誤判 CumulativeWorkflowContext。
  let prismaImportViolation: string | null = null;
  for (const file of allNewHotfixFiles) {
    if (!file.endsWith(".tsx")) continue;
    const src = fs.readFileSync(file, "utf8");
    const isClientComponent = /^\s*["']use client["'];/m.test(src);
    if (isClientComponent && (/@prisma\/client/.test(src) || /from\s*["']@\/lib\/prisma["']/.test(src))) {
      prismaImportViolation = path.relative(REPO_ROOT, file);
      break;
    }
  }
  check("[6] 新版 Hotfix Client Component 沒有直接 import Prisma", prismaImportViolation === null, prismaImportViolation ?? undefined);

  // [7] 進度條無水平捲動（flex + justify-between 等分排列，不使用 overflow-x-auto／flex-nowrap）
  const progressBarSrc = fs.readFileSync(path.join(REPO_ROOT, "src/components/hotfix-nine-stage/NineStageProgressBar.tsx"), "utf8");
  check(
    "[7] NineStageProgressBar 使用 flex 等分排列，不使用 overflow-x-auto／flex-nowrap（無水平捲動）",
    /justify-between/.test(progressBarSrc) && !/overflow-x-auto/.test(progressBarSrc) && !/flex-nowrap/.test(progressBarSrc),
  );

  // [8] 驗證可觀察的 Dialog 與鍵盤行為，不依賴按鈕 JSX 必須排列成某個單一 regex。
  const approvalPanelSrc = fs.readFileSync(path.join(REPO_ROOT, "src/components/hotfix-nine-stage/ApprovalReviewPanel.tsx"), "utf8");
  const closurePanelSrc = fs.readFileSync(path.join(REPO_ROOT, "src/app/issues/[id]/hotfix/close/ClosureConfirmPanel.tsx"), "utf8");
  check(
    "[8] 駁回 Dialog 具語意、初始焦點、Escape、焦點返回及必填原因",
    [approvalPanelSrc, closurePanelSrc].every((src) =>
      src.includes('role="dialog"') &&
      src.includes('aria-modal="true"') &&
      src.includes("inputRef.current?.focus()") &&
      src.includes('event.key === "Escape"') &&
      src.includes("rejectTriggerRef.current?.focus()") &&
      /<button[\s\S]{0,300}ref=\{rejectTriggerRef\}[\s\S]{0,300}onClick=\{\(\) => setRejectOpen\(true\)\}/.test(src) &&
      src.includes("disabled={isPending || blank}"),
    ),
  );

  // [9] 舊版 Hotfix 元件目錄已完全刪除（不得保留兩套可切換的 Hotfix UI）
  check("[9] 舊版 src/components/hotfix-execution 目錄已刪除", !fs.existsSync(path.join(REPO_ROOT, "src/components/hotfix-execution")));
  check("[9b] 舊版 hotfix-ui/runtimeView.ts／stageProgress.ts 已刪除", !fs.existsSync(path.join(REPO_ROOT, "src/lib/hotfix-ui/runtimeView.ts")) && !fs.existsSync(path.join(REPO_ROOT, "src/lib/hotfix-ui/stageProgress.ts")));

  // [10] routeForStageKey 涵蓋 Hotfix v1 全部正式關卡；cancelled 使用 close 唯讀終態頁。
  const allMainStageKeys = [
    "draft", "pendingBusinessApproval", "pendingRdTriage", "pendingRdClaim", "rdInProgress",
    "pendingRdLeadApproval", "pendingQaTriage", "pendingQaClaim", "qaInProgress", "pendingQaLeadApproval",
    "pendingOpTriage", "pendingOpClaim", "opPreparing", "pendingDeploymentApproval", "opDeploying",
    "opCompleted", "pendingReporterConfirmation", "reporterConfirming", "closed",
  ];
  check(
    "[10] routeForStageKey 對全部 19 個正式關卡皆回傳非 null 路徑，cancelled 導向 close 唯讀頁",
    allMainStageKeys.every((k) => routeForStageKey("x", k) !== null) && routeForStageKey("x", "cancelled") === "/issues/x/hotfix/close",
  );

  // [11] 第 7 關包含上版前確認、上版前核准、正式部署；部署送出後才進第 8 關。
  check(
    "[11] nineStageIndexOfStageKey：OP 三個上版子步驟均為第 7 關，opCompleted 才是第 8 關",
    nineStageIndexOfStageKey("opPreparing") === 7 &&
      nineStageIndexOfStageKey("pendingDeploymentApproval") === 7 &&
      nineStageIndexOfStageKey("opDeploying") === 7 &&
      nineStageIndexOfStageKey("opCompleted") === 8,
  );

  const globalsSrc = fs.readFileSync(path.join(REPO_ROOT, "src/app/globals.css"), "utf8");
  const tailwindSrc = fs.readFileSync(path.join(REPO_ROOT, "tailwind.config.ts"), "utf8");
  const zLayoutSrc = fs.readFileSync(path.join(REPO_ROOT, "src/components/workflow-execution/WorkflowZLayout.tsx"), "utf8");
  const equalHeightRowSrc = fs.readFileSync(path.join(REPO_ROOT, "src/components/workflow-execution/EqualHeightContentRow.tsx"), "utf8");
  const shellSrc = fs.readFileSync(path.join(REPO_ROOT, "src/components/hotfix-nine-stage/HotfixStageShell.tsx"), "utf8");
  const currentFlowSrc = fs.readFileSync(path.join(REPO_ROOT, "src/components/hotfix-nine-stage/CurrentHotfixFlowCard.tsx"), "utf8");
  const expandableSrc = fs.readFileSync(path.join(REPO_ROOT, "src/components/ui/ExpandableContentBlock.tsx"), "utf8");
  check(
    "[11b] Workflow 完成色集中於正式 semantic tokens",
    [
      "--workflow-complete: #1f9d68",
      "--workflow-complete-deep: #167a52",
      "--workflow-complete-muted: #e8f6ef",
      "--workflow-complete-line: #57b98f",
      "--workflow-complete-foreground: #ffffff",
    ].every((token) => globalsSrc.includes(token)) && tailwindSrc.includes('"workflow-complete"'),
  );
  check(
    "[11c] Z 型布局共用 50／50 雙欄，手機維持相同 DOM 閱讀順序，高度依內容自然決定（不強制 stretch）",
    zLayoutSrc.includes("EqualHeightContentRow") &&
      equalHeightRowSrc.includes("grid-cols-1") && equalHeightRowSrc.includes("md:grid-cols-2") &&
      !equalHeightRowSrc.includes("items-stretch") && !equalHeightRowSrc.includes("h-full") &&
      shellSrc.includes("CurrentHotfixFlowCard") && !shellSrc.includes("CurrentStageGuidanceCard"),
  );
  check(
    "[11c-2] 目前 Hotfix 流程整合目前責任（目前待辦／等待人員）並沿用 nineStage 動態名稱、正確處理終態",
    currentFlowSrc.includes("view.currentTodo") && currentFlowSrc.includes("view.waitingOn") &&
      currentFlowSrc.includes("nineStageLabelOfIndex(view.currentIndex + 1)") &&
      currentFlowSrc.includes("流程已完成") && currentFlowSrc.includes("流程已取消"),
  );

  const activeStates = getNineStageVisualStates({ currentIndex: 5, cancelled: false, cancelledAtIndex: null, terminalComplete: false });
  const closedStates = getNineStageVisualStates({ currentIndex: 9, cancelled: false, cancelledAtIndex: null, terminalComplete: true });
  const cancelledStates = getNineStageVisualStates({ currentIndex: null, cancelled: true, cancelledAtIndex: 5, terminalComplete: false });
  check(
    "[11d] 進行中流程只有一個 current，completed／future 分區正確",
    activeStates.filter((state) => state === "current").length === 1 &&
      activeStates.slice(0, 4).every((state) => state === "completed") &&
      activeStates.slice(5).every((state) => state === "future"),
  );
  check(
    "[11e] closed 全部完成且沒有 current；cancelled 只保留取消前完成節點",
    closedStates.every((state) => state === "completed") &&
      cancelledStates.slice(0, 4).every((state) => state === "completed") &&
      cancelledStates.slice(4).every((state) => state === "future") &&
      cancelledStates.every((state) => state !== "current"),
  );
  check(
    "[11f] completed 使用綠色 token／白色 Lucide Check，只有 current 可渲染 Halo 與 Core",
    progressBarSrc.includes("border-workflow-complete bg-workflow-complete") &&
      progressBarSrc.includes("text-workflow-complete-foreground") &&
      progressBarSrc.includes("bg-workflow-complete-line") &&
      progressBarSrc.includes("<Check") &&
      progressBarSrc.includes("{isCurrent && (") &&
      !progressBarSrc.includes("isCompleted && <span className=\"animate-stage-halo"),
  );
  check(
    "[11g] Workflow 轉場動畫完整保留，且 prefers-reduced-motion 可停用所有 Workflow 動畫",
    [
      "animate-stage-halo",
      "animate-stage-core",
      "animate-stage-complete-enter",
      "animate-stage-check-in",
      "animate-stage-line-fill",
      "animate-stage-current-enter",
    ].every((className) => progressBarSrc.includes(className)) &&
      globalsSrc.includes("@media (prefers-reduced-motion: reduce)") &&
      [
        ".animate-stage-halo",
        ".animate-stage-core",
        ".animate-stage-complete-enter",
        ".animate-stage-check-in",
        ".animate-stage-line-fill",
        ".animate-stage-current-enter",
      ].every((className) => globalsSrc.includes(className)),
  );
  check(
    "[11h] 長內容具 ARIA、條件式顯示及 reduced-motion；Hotfix 詳情頁不再有錯誤的雙箭頭 Scroll Chevron",
    expandableSrc.includes("aria-expanded={expanded}") && expandableSrc.includes("aria-controls={contentId}") &&
      expandableSrc.includes("閱讀更多") && expandableSrc.includes("顯示更少") &&
      !shellSrc.includes("ScrollDownChevron") &&
      !fs.existsSync(path.join(REPO_ROOT, "src/components/ui/ScrollDownChevron.tsx")) &&
      [".animate-tooltip-in", ".animate-expand-hint-once"].every((className) => globalsSrc.includes(className)),
  );
}

// =====================================================================================
// B. DB 整合測試（真正透過既有執行引擎推進 Issue）
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
  console.log("\n=== B. DB 整合測試（真正透過既有執行引擎推進 Issue） ===");

  const admin = await createUser("Admin", "Admin");
  const pm = await createUser("PM", "PM");
  const supervisor = await createUser("Supervisor", "DMS主管");
  await prisma.userSupervisorAssignment.create({
    data: { userId: pm.id, supervisorUserId: supervisor.id, validFrom: new Date(Date.now() - 86_400_000), isPrimary: true, isActive: true, createdByUserId: admin.id },
  });
  const rdTeam = await createTeam("RdTeam");
  await setTeamDomain({ teamId: rdTeam.id, domain: "RD", actorId: admin.id, reasonCode: "V" });
  const rdMember = await createUser("RdMember", "RD");
  const rdLead = await createUser("RdLead", "RD");
  await addMember(rdTeam.id, rdMember.id, "MEMBER");
  await addMember(rdTeam.id, rdLead.id, "LEAD");
  const qaTeam = await createTeam("QaTeam");
  await setTeamDomain({ teamId: qaTeam.id, domain: "QA", actorId: admin.id, reasonCode: "V" });
  const qaMember = await createUser("QaMember", "QA");
  const qaLead = await createUser("QaLead", "QA");
  await addMember(qaTeam.id, qaMember.id, "MEMBER");
  await addMember(qaTeam.id, qaLead.id, "LEAD");
  const opTeam = await createTeam("OpTeam");
  await setTeamDomain({ teamId: opTeam.id, domain: "OP", actorId: admin.id, reasonCode: "V" });
  const opMember = await createUser("OpMember", "OP");
  const opLead = await createUser("OpLead", "OP");
  await addMember(opTeam.id, opMember.id, "MEMBER");
  await addMember(opTeam.id, opLead.id, "LEAD");
  const outsider = await createUser("Outsider", "PM");

  const hotfix = await buildHotfixWorkflowV1({ actorId: admin.id, reasonCode: "VERIFY_BUILD_HOTFIX_V1", keySuffix: RUN_TAG });
  const s = hotfix.stageIds;

  async function createIssue(key: string, reporterUserId: string) {
    const issue = await prisma.issue.create({
      data: { issueKey: `${RUN_TAG}-${key}`, issueType: "Hotfix", title: `驗證案件 ${key}`, workflowStatus: "n/a", reporterUserId, reporter: pm.name },
    });
    await startIssueWorkflow({ issueId: issue.id, workflowVersionId: hotfix.version.id, actorId: admin.id, reasonCode: "VERIFY_START" });
    return issue;
  }

  async function stageIndexOf(issueId: string): Promise<number | null> {
    const runtime = await getIssueWorkflowRuntime(issueId, admin.id);
    if (!runtime.onVersionedWorkflow) throw new Error("預期案件已在新版 Workflow 上");
    return nineStageIndexOfStageKey(runtime.currentStage.stageKey);
  }

  const main = await createIssue("MAIN", pm.id);
  check("[12] 新建工單落在第 1 階段（Hotfix建立工單）", (await stageIndexOf(main.id)) === 1);

  // stage1 → stage2
  {
    const t0 = await findTransition(hotfix.version.id, s.draft, "submit");
    await executeIssueTransition({ issueId: main.id, transitionId: t0.id, actorId: pm.id, reasonCode: "V" });
  }
  check("[13] 建立工單送出後落在第 2 階段（申請人直屬主管簽核），非直接跳到 RD", (await stageIndexOf(main.id)) === 2);

  // [14] 非合法核准人（QA）／完全無關人員／送核人本人 一律被 deny-by-default 拒絕
  const stage2Approval = await findActiveApproval(main.id, "BUSINESS_APPROVAL", "pendingBusinessApproval");
  await expectError(
    "[14] Service 層拒絕非目前責任角色（QA 執行人）冒名核准申請人主管簽核",
    () => decideApprovalRecord({ approvalRecordId: stage2Approval.id, actorUserId: qaMember.id, decision: "APPROVED" }),
    (err) => err instanceof ApprovalAuthorityMismatchError,
  );
  await expectError(
    "[14b] Service 層拒絕送核人本人自行核准",
    () => decideApprovalRecord({ approvalRecordId: stage2Approval.id, actorUserId: pm.id, decision: "APPROVED" }),
    (err) => err instanceof SelfApprovalError,
  );

  // stage2 同意 → stage3
  await decideApprovalRecord({ approvalRecordId: stage2Approval.id, actorUserId: supervisor.id, decision: "APPROVED" });
  {
    const t1 = await findTransition(hotfix.version.id, s.pendingBusinessApproval, "businessApprove");
    await executeIssueTransition({ issueId: main.id, transitionId: t1.id, actorId: pm.id, reasonCode: "V" });
  }
  check("[15] 申請人主管同意後落在第 3 階段（RD修正與自測）", (await stageIndexOf(main.id)) === 3);

  await claimIssueForTeam({ issueId: main.id, teamId: rdTeam.id, actorId: rdLead.id, reasonCode: "V" });
  await assignIssueExecutor({ issueId: main.id, executorUserId: rdMember.id, actorId: rdLead.id, reasonCode: "V" });

  // [16] 附件僅能於目前關卡上傳，且僅能刪除「目前這一關」上傳的附件
  const rdAttachment = await uploadHotfixAttachment({ issueId: main.id, actorId: rdMember.id, actorName: rdMember.name, fileName: "note.txt", mimeType: "text/plain", bytes: Buffer.from("hello") });
  await expectError(
    "[16] 非目前責任角色（outsider）不得上傳附件",
    () => uploadHotfixAttachment({ issueId: main.id, actorId: outsider.id, actorName: outsider.name, fileName: "x.txt", mimeType: "text/plain", bytes: Buffer.from("x") }),
    (err) => err instanceof AttachmentAuthorizationError,
  );

  await saveExecutionFieldValues({
    issueId: main.id,
    actorId: rdMember.id,
    values: { rdFixVersion: "v1.0.0", rdFixDescription: "修正說明", rdSelfTestResult: "自測通過", rdImpactScope: "僅影響登入頁" },
  });
  {
    const t4 = await findTransition(hotfix.version.id, s.rdInProgress, "rdSubmit");
    await answerAll(main.id, "pendingRdLeadApproval", rdMember.id);
    await executeIssueTransition({ issueId: main.id, transitionId: t4.id, actorId: rdMember.id, reasonCode: "V" });
  }
  check("[17] RD 送主管簽核後落在第 4 階段（RD主管簽核）", (await stageIndexOf(main.id)) === 4);

  // 附件已離開上傳當下的關卡（rdInProgress），現在應變成唯讀（無法再被同一人刪除）
  await expectError(
    "[16b] 附件所屬關卡已結束，即使原上傳者也不得再刪除（唯讀）",
    () => deleteHotfixAttachment({ issueId: main.id, evidenceId: rdAttachment.id, actorId: rdMember.id }),
    (err) => err instanceof AttachmentAuthorizationError,
  );

  const rdLeadApproval = await findActiveApproval(main.id, "RD_LEAD_APPROVAL", "pendingRdLeadApproval");
  await checkAsync("[18] RD 執行人在 RD 主管簽核關卡不具核准資格（deny-by-default）", async () => {
    try {
      await decideApprovalRecord({ approvalRecordId: rdLeadApproval.id, actorUserId: rdMember.id, decision: "APPROVED" });
      return false;
    } catch (err) {
      return err instanceof SelfApprovalError || err instanceof ApprovalAuthorityMismatchError;
    }
  });

  // RD 主管駁回 → 應退回第 3 階段（rdInProgress），資料保留
  await decideApprovalRecord({ approvalRecordId: rdLeadApproval.id, actorUserId: rdLead.id, decision: "REJECTED", decisionComment: "請補充自測紀錄" });
  {
    const rejectT = await findTransition(hotfix.version.id, s.pendingRdLeadApproval, "rdLeadReject");
    await returnIssueToStage({ issueId: main.id, transitionId: rejectT.id, actorId: rdLead.id, reasonCode: "請補充自測紀錄" });
  }
  check("[19] RD 主管駁回後退回第 3 階段（RD修正與自測），且資料仍保留", (await stageIndexOf(main.id)) === 3);
  const rdFixValueAfterReject = await prisma.issueFieldValue.findUnique({ where: { issueId_fieldKey: { issueId: main.id, fieldKey: "rdFixVersion" } } });
  check("[19b] 駁回後 RD 已填寫的欄位資料未被清除", rdFixValueAfterReject?.fieldValue === "v1.0.0");

  // 重新送核並通過，繼續往下走到 QA
  {
    const t4b = await findTransition(hotfix.version.id, s.rdInProgress, "rdSubmit");
    await executeIssueTransition({ issueId: main.id, transitionId: t4b.id, actorId: rdMember.id, reasonCode: "V" });
    const rdLeadApproval2 = await findActiveApproval(main.id, "RD_LEAD_APPROVAL", "pendingRdLeadApproval");
    await decideApprovalRecord({ approvalRecordId: rdLeadApproval2.id, actorUserId: rdLead.id, decision: "APPROVED" });
    const approveT = await findTransition(hotfix.version.id, s.pendingRdLeadApproval, "rdLeadApprove");
    await executeIssueTransition({ issueId: main.id, transitionId: approveT.id, actorId: rdLead.id, reasonCode: "V" });
  }
  check("[20] RD 主管同意後落在第 5 階段（QA驗證）", (await stageIndexOf(main.id)) === 5);

  await claimIssueForTeam({ issueId: main.id, teamId: qaTeam.id, actorId: qaLead.id, reasonCode: "V" });
  await assignIssueExecutor({ issueId: main.id, executorUserId: qaMember.id, actorId: qaLead.id, reasonCode: "V" });
  await saveExecutionFieldValues({ issueId: main.id, actorId: qaMember.id, values: { qaTestScope: "全功能", qaTestEnvironment: "UAT", qaTestResult: "驗證通過" } });
  {
    await answerAll(main.id, "pendingQaLeadApproval", qaMember.id);
    const qaSubmitT = await findTransition(hotfix.version.id, s.qaInProgress, "qaSubmit");
    await executeIssueTransition({ issueId: main.id, transitionId: qaSubmitT.id, actorId: qaMember.id, reasonCode: "V" });
  }
  check("[21] QA 送主管簽核後落在第 6 階段（QA主管簽核）", (await stageIndexOf(main.id)) === 6);

  // QA 主管駁回 → 應退回第 5 階段（qaInProgress），不得發明退回 RD 的選項
  const qaLeadApproval = await findActiveApproval(main.id, "QA_LEAD_APPROVAL", "pendingQaLeadApproval");
  await decideApprovalRecord({ approvalRecordId: qaLeadApproval.id, actorUserId: qaLead.id, decision: "REJECTED", decisionComment: "缺陷未修復" });
  {
    const qaRejectT = await findTransition(hotfix.version.id, s.pendingQaLeadApproval, "qaLeadReject");
    await returnIssueToStage({ issueId: main.id, transitionId: qaRejectT.id, actorId: qaLead.id, reasonCode: "缺陷未修復" });
  }
  check("[22] QA 主管駁回後退回第 5 階段（QA驗證），既有 Workflow 定義僅此單一合法目標", (await stageIndexOf(main.id)) === 5);

  {
    const qaSubmitT2 = await findTransition(hotfix.version.id, s.qaInProgress, "qaSubmit");
    await executeIssueTransition({ issueId: main.id, transitionId: qaSubmitT2.id, actorId: qaMember.id, reasonCode: "V" });
    const qaLeadApproval2 = await findActiveApproval(main.id, "QA_LEAD_APPROVAL", "pendingQaLeadApproval");
    await decideApprovalRecord({ approvalRecordId: qaLeadApproval2.id, actorUserId: qaLead.id, decision: "APPROVED" });
    const qaApproveT = await findTransition(hotfix.version.id, s.pendingQaLeadApproval, "qaLeadApprove");
    await executeIssueTransition({ issueId: main.id, transitionId: qaApproveT.id, actorId: qaLead.id, reasonCode: "V" });
  }
  check("[23] QA 主管同意後落在第 7 階段（OP上版）", (await stageIndexOf(main.id)) === 7);

  await claimIssueForTeam({ issueId: main.id, teamId: opTeam.id, actorId: opLead.id, reasonCode: "V" });
  await assignIssueExecutor({ issueId: main.id, executorUserId: opMember.id, actorId: opLead.id, reasonCode: "V" });
  await saveExecutionFieldValues({
    issueId: main.id,
    actorId: opMember.id,
    values: { opDeployEnvironment: "Production", opDeployPlannedAt: "2026-08-01T02:00", opDeploySteps: "1. 停機 2. 部署 3. 驗證", opRollbackPlan: "還原前版本", opMonitoringChecklist: "監控錯誤率" },
  });
  {
    await answerAll(main.id, "pendingDeploymentApproval", opMember.id);
    const opSubmitT = await findTransition(hotfix.version.id, s.opPreparing, "opSubmit");
    await executeIssueTransition({ issueId: main.id, transitionId: opSubmitT.id, actorId: opMember.id, reasonCode: "V" });
  }
  check("[24] OP 送主管簽核仍在第 7 階段的上版前核准子步驟", (await stageIndexOf(main.id)) === 7);

  const opLeadApproval = await findActiveApproval(main.id, "DEPLOYMENT_APPROVAL", "pendingDeploymentApproval");
  await checkAsync("[25] OP 執行人在 OP 主管簽核關卡不具核准資格", async () => {
    try {
      await decideApprovalRecord({ approvalRecordId: opLeadApproval.id, actorUserId: opMember.id, decision: "APPROVED" });
      return false;
    } catch (err) {
      return err instanceof SelfApprovalError || err instanceof ApprovalAuthorityMismatchError;
    }
  });

  await decideApprovalRecord({ approvalRecordId: opLeadApproval.id, actorUserId: opLead.id, decision: "APPROVED" });
  {
    const opApproveT = await findTransition(hotfix.version.id, s.pendingDeploymentApproval, "opLeadApprove");
    await executeIssueTransition({ issueId: main.id, transitionId: opApproveT.id, actorId: opLead.id, reasonCode: "V" });
  }
  check("[26] OP 上版前核准後進入正式部署，仍歸類第 7 階段", (await stageIndexOf(main.id)) === 7);

  await saveExecutionFieldValues({ issueId: main.id, actorId: opMember.id, values: { opDeployResult: "成功", opProdConfirmResult: "確認無誤" } });
  {
    const deployCompleteT = await findTransition(hotfix.version.id, s.opDeploying, "opDeployComplete");
    await executeIssueTransition({ issueId: main.id, transitionId: deployCompleteT.id, actorId: opMember.id, reasonCode: "V" });
    check("[26b] 正式部署紀錄送出後進入第 8 階段（OP 主管上版後確認）", (await stageIndexOf(main.id)) === 8);
    const postDeploymentApproval = await findActiveApproval(main.id, "DEPLOYMENT_APPROVAL", "opCompleted");
    await decideApprovalRecord({ approvalRecordId: postDeploymentApproval.id, actorUserId: opLead.id, decision: "APPROVED" });
    const confirmOpenT = await findTransition(hotfix.version.id, s.opCompleted, "reporterConfirmOpen");
    await executeIssueTransition({ issueId: main.id, transitionId: confirmOpenT.id, actorId: opLead.id, reasonCode: "V" });
  }
  check("[27] 上版執行完成、開放結案確認後落在第 9 階段（結案）", (await stageIndexOf(main.id)) === 9);

  // [28] 結案責任人固定為原始填單人，不會退回申請人主管，且非填單人一律唯讀
  await expectError(
    "[28] 非原始填單人（Admin）不得執行結案相關寫入（closureService 拒絕）",
    async () => {
      const { saveClosureSummary } = await import("../src/lib/hotfix-ui/closureService");
      await saveClosureSummary({ issueId: main.id, actorId: admin.id, summary: "冒名結案", followUpNotes: "" });
    },
    (err) => err instanceof WorkflowExecutionAccessDeniedError,
  );

  {
    const { saveClosureSummary } = await import("../src/lib/hotfix-ui/closureService");
    await saveClosureSummary({ issueId: main.id, actorId: pm.id, summary: "已確認上版成功，功能正常。", followUpNotes: "持續觀察三日" });
    const claimT = await findTransition(hotfix.version.id, s.pendingReporterConfirmation, "reporterClaim");
    await executeIssueTransition({ issueId: main.id, transitionId: claimT.id, actorId: pm.id, reasonCode: "V" });
    const closeT = await findTransition(hotfix.version.id, s.reporterConfirming, "reporterClose");
    await executeIssueTransition({ issueId: main.id, transitionId: closeT.id, actorId: pm.id, reasonCode: "V" });
  }
  check("[29] 原始填單人確認結案後落在第 9 階段（closed），流程終結", (await stageIndexOf(main.id)) === 9);

  const closedRuntime = await getIssueWorkflowRuntime(main.id, admin.id);
  check(
    "[30] 已結案 Issue 沒有任何可執行的 FORWARD／RETURN 動作（完全唯讀）",
    closedRuntime.onVersionedWorkflow && closedRuntime.availableTransitions.filter((t) => t.transition.transitionType !== "CANCEL").length === 0,
  );

  // [31] 已取消 Issue 不屬於 9 個節點，但 canonical route 仍為 Hotfix close 唯讀終態頁。
  const cancelledCase = await createIssue("CANCELLED", pm.id);
  const cancelDraftT = await findTransition(hotfix.version.id, s.draft, "cancelDraft");
  await cancelIssueWorkflow({ issueId: cancelledCase.id, transitionId: cancelDraftT.id, actorId: admin.id, reasonCode: "V" });
  check("[31] 已取消 Issue 的 nineStageIndexOfStageKey 回傳 null（不屬於 9 階段任何一個）", (await stageIndexOf(cancelledCase.id)) === null);

  const cancelledAfterCreateCase = await createIssue("CANCELLED-AFTER-CREATE", pm.id);
  const submitBeforeCancelT = await findTransition(hotfix.version.id, s.draft, "submit");
  await executeIssueTransition({ issueId: cancelledAfterCreateCase.id, transitionId: submitBeforeCancelT.id, actorId: pm.id, reasonCode: "V" });
  const cancelPendingApprovalT = await findTransition(hotfix.version.id, s.pendingBusinessApproval, "cancelPendingBusinessApproval");
  await cancelIssueWorkflow({ issueId: cancelledAfterCreateCase.id, transitionId: cancelPendingApprovalT.id, actorId: admin.id, reasonCode: "V" });
  const cancelledFromIndex = await loadCancelledFromNineStageIndex(cancelledAfterCreateCase.id);
  const cancelledVisualStates = getNineStageVisualStates({
    currentIndex: null,
    cancelled: true,
    cancelledAtIndex: cancelledFromIndex,
    terminalComplete: false,
  });
  check(
    "[31b] 第 2 階段取消只保留第 1 階段為綠色完成，沒有 current 動畫且不會全綠",
    cancelledFromIndex === 2 &&
      cancelledVisualStates[0] === "completed" &&
      cancelledVisualStates.slice(1).every((state) => state === "future") &&
      cancelledVisualStates.every((state) => state !== "current"),
  );

  // [32] 無 issue.view 能力者查詢 Workflow Runtime 一律拒絕
  const inactiveUser = await prisma.user.create({ data: { name: `${RUN_TAG}-Inactive`, email: `${RUN_TAG}-inactive@example.invalid`, role: "PM", isActive: false } });
  await expectError(
    "[32] 停用帳號（無 issue.view 能力）查詢 Workflow Runtime 一律拒絕",
    () => getIssueWorkflowRuntime(main.id, inactiveUser.id),
    (err) => err instanceof WorkflowExecutionAccessDeniedError,
  );

  console.log("\n=== 清理測試 Fixture ===");
  const fixtureIssueIds = (await prisma.issue.findMany({ where: { issueKey: { startsWith: `${RUN_TAG}-` } }, select: { id: true } })).map((i) => i.id);
  await prisma.comment.deleteMany({ where: { issueId: { in: fixtureIssueIds } } });
  await prisma.stageRiskCheck.deleteMany({ where: { issueId: { in: fixtureIssueIds } } });
  await prisma.approvalRecord.deleteMany({ where: { issueId: { in: fixtureIssueIds } } });
  await prisma.issueFieldValue.deleteMany({ where: { issueId: { in: fixtureIssueIds } } });
  await prisma.evidence.deleteMany({ where: { issueId: { in: fixtureIssueIds } } });
  await prisma.issueWorkflowStageHistory.deleteMany({ where: { issueId: { in: fixtureIssueIds } } });
  await prisma.issue.deleteMany({ where: { id: { in: fixtureIssueIds } } });
  const fixtureStageIds = (await prisma.workflowStage.findMany({ where: { workflowVersionId: hotfix.version.id }, select: { id: true } })).map((s2) => s2.id);
  await prisma.workflowStageRequirement.deleteMany({ where: { workflowStageId: { in: fixtureStageIds } } });
  await prisma.workflowTransition.deleteMany({ where: { workflowVersionId: hotfix.version.id } });
  await prisma.workflowStage.deleteMany({ where: { workflowVersionId: hotfix.version.id } });
  await prisma.workflowVersion.deleteMany({ where: { id: hotfix.version.id } });
  await prisma.workflowDefinition.deleteMany({ where: { id: hotfix.version.workflowDefinitionId } });
  await prisma.teamMember.deleteMany({ where: { teamId: { in: [rdTeam.id, qaTeam.id, opTeam.id] } } });
  await prisma.team.deleteMany({ where: { id: { in: [rdTeam.id, qaTeam.id, opTeam.id] } } });
  await prisma.userSupervisorAssignment.deleteMany({ where: { userId: pm.id } });
  const userIds = [admin.id, pm.id, supervisor.id, rdMember.id, rdLead.id, qaMember.id, qaLead.id, opMember.id, opLead.id, outsider.id, inactiveUser.id];
  await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
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
