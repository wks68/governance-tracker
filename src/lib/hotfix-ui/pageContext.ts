// Hotfix 九階段 UI：9 個獨立頁面共用的資料組裝層。只做唯讀查詢＋組裝 ViewModel，不做任何
// 寫入、不做授權「決定」——授權一律由 workflow-execution／approvalService 於實際送出動作時
// 現場重新解析（本檔案算出的 canAct 只決定要不要顯示表單／按鈕，不是信任邊界本身）。

import { prisma } from "../prisma";
import { getIssueWorkflowRuntime, evaluateActorEligibilityForStage, type IssueWorkflowRuntime } from "../workflowExecutionService";
import { nineStageIndexOfStageKey, routeForStageKey, isCancelledStageKey } from "./nineStage";
import { HOTFIX_PRIORITY_FIELD_KEY } from "./priority";
import type { TicketBasicInfoData } from "@/components/hotfix-nine-stage/TicketBasicInfo";
import type { Issue, User } from "@prisma/client";

export class HotfixPageNotApplicableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HotfixPageNotApplicableError";
  }
}

export interface HotfixPageContext {
  issue: Issue;
  actor: User;
  runtime: Extract<IssueWorkflowRuntime, { onVersionedWorkflow: true }>;
  nineStageIndex: number | null;
  cancelled: boolean;
  ticketBasicInfo: TicketBasicInfoData;
  /** 若目前關卡不屬於呼叫頁面宣告的 allowedStageKeys，回傳應轉址的正確頁面路徑。 */
  redirectTo: string | null;
}

async function loadHotfixPriority(issueId: string): Promise<string | null> {
  const row = await prisma.issueFieldValue.findUnique({ where: { issueId_fieldKey: { issueId, fieldKey: HOTFIX_PRIORITY_FIELD_KEY } } });
  return row?.fieldValue ?? null;
}

// allowedStageKeys：呼叫頁面宣告「自己負責哪些 stageKey」，目前關卡不在此清單內時，
// redirectTo 會指向正確的頁面（由 routeForStageKey 唯一判斷），呼叫端應立即 redirect()。
export async function loadHotfixPageContext(issueId: string, actor: User, allowedStageKeys: readonly string[]): Promise<HotfixPageContext> {
  const issue = await prisma.issue.findUnique({ where: { id: issueId } });
  if (!issue) throw new HotfixPageNotApplicableError("找不到此工單");
  if (issue.issueType !== "Hotfix") throw new HotfixPageNotApplicableError("此工單不是 Hotfix 類型");

  const runtime = await getIssueWorkflowRuntime(issueId, actor.id);
  if (!runtime.onVersionedWorkflow) {
    throw new HotfixPageNotApplicableError("此 Hotfix 工單尚未啟動新版流程引擎，請回工單詳情頁查看");
  }

  const stageKey = runtime.currentStage.stageKey;
  const cancelled = isCancelledStageKey(stageKey);
  const nineStageIndex = nineStageIndexOfStageKey(stageKey);

  let redirectTo: string | null = null;
  if (!allowedStageKeys.includes(stageKey)) {
    redirectTo = routeForStageKey(issueId, stageKey);
  }

  const hotfixPriority = await loadHotfixPriority(issueId);
  const ticketBasicInfo: TicketBasicInfoData = {
    issueKey: issue.issueKey,
    reporterName: issue.reporter,
    environment: issue.environment,
    title: issue.title,
    description: issue.description,
    systemName: issue.systemName,
    riskLevel: issue.riskLevel,
    hotfixPriority,
    dueDate: issue.dueDate ? issue.dueDate.toISOString() : null,
  };

  return { issue, actor, runtime, nineStageIndex, cancelled, ticketBasicInfo, redirectTo };
}

// 供「執行頁」（stage1/3/5/7）判斷目前使用者是不是這一關真正的責任角色（僅決定要不要顯示
// 可編輯表單，實際寫入仍由服務層重新授權）。
export async function isActorResponsibleForExecutionStage(ctx: HotfixPageContext): Promise<boolean> {
  const stage = ctx.runtime.currentStage;
  const result = await evaluateActorEligibilityForStage(
    prisma,
    ctx.actor.id,
    { assignedTeamId: ctx.issue.assignedTeamId },
    { requiredExecutionRole: stage.requiredExecutionRole, requiredMembershipRole: stage.requiredMembershipRole, stageKey: stage.stageKey },
  );
  return result.eligible;
}

export interface ApprovalReviewViewData {
  approvalRecordId: string;
  requestedByName: string;
  requestedAt: string;
  isResponsible: boolean;
  expectedApproverLabel: string | null;
}

// 4 個獨立主管簽核頁共用：組出 ApprovalReviewPanel 需要的資料。isResponsible 判斷邏輯與
// src/lib/hotfix-ui/runtimeView.ts 既有（即將淘汰的舊版單頁）APPROVAL 關卡資格預覽邏輯
// 完全一致——expectedApproverUserId 唯一時直接比對，多位合格候選人（null）時退回以
// 「目前處理團隊的 LEAD 身分」預覽近似，實際授權仍一律由 decideApprovalRecord 現場重新
// 解析，這裡的結果只決定要不要顯示按鈕。
export async function buildApprovalReviewViewData(ctx: HotfixPageContext): Promise<ApprovalReviewViewData | null> {
  const record = ctx.runtime.pendingApproval;
  if (!record) return null;

  const [requestedBy, expectedApprover] = await Promise.all([
    prisma.user.findUnique({ where: { id: record.requestedByUserId } }),
    record.expectedApproverUserId ? prisma.user.findUnique({ where: { id: record.expectedApproverUserId } }) : Promise.resolve(null),
  ]);

  let isResponsible: boolean;
  if (record.decision !== "PENDING") {
    isResponsible = false;
  } else if (record.expectedApproverUserId !== null) {
    isResponsible = record.expectedApproverUserId === ctx.actor.id;
  } else {
    const leadEligibility = await evaluateActorEligibilityForStage(
      prisma,
      ctx.actor.id,
      { assignedTeamId: ctx.issue.assignedTeamId },
      { requiredExecutionRole: null, requiredMembershipRole: "LEAD", stageKey: ctx.runtime.currentStage.stageKey },
    );
    isResponsible = leadEligibility.eligible;
  }

  return {
    approvalRecordId: record.id,
    requestedByName: requestedBy?.name ?? "（未知）",
    requestedAt: record.requestedAt.toISOString(),
    isResponsible,
    expectedApproverLabel: expectedApprover ? expectedApprover.name : record.expectedApproverUserId === null ? "處理團隊的主管（LEAD）" : null,
  };
}

// stage1「Hotfix建立工單」的責任角色固定是原始填單人（reporterUserId），不得透過
// User.role 或團隊成員身分判斷——與其他執行關卡（RD/QA/OP 執行人）判斷方式不同，因此
// 獨立一個函式，不硬塞進 isActorResponsibleForExecutionStage。
export function isActorOriginalReporter(ctx: HotfixPageContext): boolean {
  return !!ctx.issue.reporterUserId && ctx.issue.reporterUserId === ctx.actor.id;
}
