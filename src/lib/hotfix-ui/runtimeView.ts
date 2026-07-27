// Hotfix 操作畫面收斂新增：把 workflow-execution 服務層已經算好的資料（runtime／
// availableTransitions／stageRequirements／pendingApproval），加上這裡唯讀查詢的
// 停留天數與風險檢核完成度，組成 Issue 明細頁頂部摘要與「目前待完成事項」清單需要的
// 唯一一份 ViewModel。本檔案完全不呼叫任何寫入函式、不判斷任何授權——授權一律由
// workflow-execution 既有服務（evaluateActorEligibilityForStage 等）現場重新解析，
// 這裡只組裝顯示用的文字。

import { prisma } from "../prisma";
import { evaluateActorEligibilityForStage, type AvailableTransitionPreview } from "../workflowExecutionService";
import { getRiskCheckTemplate } from "../riskCheckTemplates";
import { businessStageIndexOf, businessStageOf, approvalBadgeOf, roleFamilyOf, roleLabelOf, HOTFIX_BUSINESS_STAGES } from "./stageProgress";
import { fieldLabelOf, evidenceLabelOf } from "./fieldLabels";
import type { StageRequirementStatus } from "../workflow-execution/types";

export interface HotfixTodoItem {
  text: string;
  anchor?: string;
}

export interface HotfixRuntimeView {
  businessStageIndex: number | null; // 0-based，null＝不在 7 業務階段對照表內（例如已結案／已取消）
  businessStageLabel: string;
  approvalBadge: string | null;
  responsibleTeamName: string | null;
  responsibleRoleLabel: string;
  isCurrentActorResponsible: boolean;
  dwellDays: number | null;
  nextBusinessStageLabel: string | null;
  todoItems: HotfixTodoItem[];
  riskStatusLabel: "已確認有風險" | "風險狀況待釐清" | "尚未填寫風險確認" | "尚無風險紀錄";
}

async function computeDwellDays(issueId: string): Promise<number | null> {
  const openRow = await prisma.issueWorkflowStageHistory.findFirst({
    where: { issueId, exitedAt: null },
    orderBy: { executedAt: "desc" },
  });
  if (!openRow) return null;
  return Math.floor((Date.now() - openRow.executedAt.getTime()) / 86_400_000);
}

// 目前 Issue 整體風險狀態（跨所有 StageRiskCheck 紀錄，YES > UNKNOWN 待釐清 > 尚未填寫 >
// 尚無紀錄），與治理儀表板 governance-dashboard/queries.ts 的 deriveRiskStatus 同一套
// 「最嚴重者優先」判斷邏輯，但刻意各自獨立實作一份——兩個功能互不依賴，避免跨功能耦合
// （見需求：不得破壞 issueCreation 與 workflow-execution 邊界）。
async function computeRiskStatusLabel(issueId: string): Promise<HotfixRuntimeView["riskStatusLabel"]> {
  const checks = await prisma.stageRiskCheck.findMany({ where: { issueId }, select: { answer: true, resolvedAt: true } });
  if (checks.some((c) => c.answer === "YES")) return "已確認有風險";
  if (checks.some((c) => c.answer === "UNKNOWN" && c.resolvedAt === null)) return "風險狀況待釐清";
  if (checks.some((c) => c.answer === null)) return "尚未填寫風險確認";
  return "尚無風險紀錄";
}

async function riskCheckTodoForTargetStage(issueId: string, targetStageKey: string): Promise<HotfixTodoItem[]> {
  const template = getRiskCheckTemplate(targetStageKey);
  if (!template) return [];
  const rows = await prisma.stageRiskCheck.findMany({ where: { issueId, stageKey: targetStageKey } });
  const maxRound = rows.length > 0 ? Math.max(...rows.map((r) => r.assessmentRound)) : 1;
  const currentRound = rows.filter((r) => r.assessmentRound === maxRound);
  const byKey = new Map(currentRound.map((r) => [r.checkKey, r]));

  const unanswered = template.filter((t) => !byKey.get(t.checkKey)?.answer);
  const unresolvedUnknown = template.filter((t) => {
    const row = byKey.get(t.checkKey);
    return row?.answer === "UNKNOWN" && row.resolvedAt === null;
  });

  const items: HotfixTodoItem[] = [];
  if (unanswered.length > 0) items.push({ text: `尚未完成風險確認（${unanswered.length} 項待填寫）`, anchor: "risk-check-section" });
  if (unresolvedUnknown.length > 0) items.push({ text: `風險狀況待釐清（${unresolvedUnknown.length} 項）`, anchor: "risk-check-section" });
  return items;
}

export interface RiskCheckItemViewData {
  checkKey: string;
  label: string;
  answer: "YES" | "NO" | "UNKNOWN" | null;
  detail: string;
  resolvedAt: string | null;
}

// 供「風險／例外」欄位區塊使用：組出某個 stageKey（一律是即將送核的目標關卡）目前
// 這一輪（assessmentRound 最大值）的完整風險確認項目清單，含尚未填答者（answer=null）。
// 純查詢，不寫入、不判斷授權——是否唯讀由呼叫端（頁面）依 isCurrentActorResponsible 決定。
export async function getRiskCheckItemsForStage(issueId: string, stageKey: string): Promise<RiskCheckItemViewData[]> {
  const template = getRiskCheckTemplate(stageKey);
  if (!template) return [];
  const rows = await prisma.stageRiskCheck.findMany({ where: { issueId, stageKey } });
  const maxRound = rows.length > 0 ? Math.max(...rows.map((r) => r.assessmentRound)) : 1;
  const byKey = new Map(rows.filter((r) => r.assessmentRound === maxRound).map((r) => [r.checkKey, r]));
  return template.map((t) => {
    const row = byKey.get(t.checkKey);
    return {
      checkKey: t.checkKey,
      label: t.label,
      answer: (row?.answer as "YES" | "NO" | "UNKNOWN" | null) ?? null,
      detail: row?.detail ?? "",
      resolvedAt: row?.resolvedAt ? row.resolvedAt.toISOString() : null,
    };
  });
}

export async function buildHotfixRuntimeView(input: {
  issueId: string;
  actorId: string;
  currentStage: { stageKey: string; label: string; stageType: string; requiredMembershipRole: string | null };
  assignedTeamId: string | null;
  assignedTeamName: string | null;
  availableTransitions: AvailableTransitionPreview[];
  stageRequirements: StageRequirementStatus[];
  pendingApprovalDecision: "PENDING" | "APPROVED" | "REJECTED" | null;
  pendingApprovalExpectedApproverUserId: string | null;
}): Promise<HotfixRuntimeView> {
  const {
    issueId,
    actorId,
    currentStage,
    assignedTeamId,
    assignedTeamName,
    availableTransitions,
    stageRequirements,
    pendingApprovalDecision,
    pendingApprovalExpectedApproverUserId,
  } = input;

  const businessStageLabel = businessStageOf(currentStage.stageKey, currentStage.label);
  const businessStageIndex = businessStageIndexOf(currentStage.stageKey);
  const approvalBadge = approvalBadgeOf(currentStage.stageKey);
  // APPROVAL 型關卡一律是主管／放行人核准層級（RD 主管／QA 主管／OP 主管；核准資格
  // 解析與團隊 LEAD 身分相關，見下方 isEligible 計算的說明），即使 WorkflowStage.
  // requiredMembershipRole 欄位本身是 null，角色標籤仍須顯示為主管視角，不是執行人。
  const responsibleRoleLabel = roleLabelOf(currentStage.stageKey, currentStage.stageType === "APPROVAL" ? "LEAD" : currentStage.requiredMembershipRole);

  // APPROVAL 型關卡的 requiredMembershipRole 恆為 null（真正核准資格由
  // approvalService 依 approvalType 現場解析 TEAM_LEAD／DIRECT_SUPERVISOR／
  // DELEGATE，不是團隊成員身分），不能沿用一般關卡的 evaluateActorEligibilityForStage
  // 判斷，否則會讓任何具 issue.edit 能力的人（例如 RD 執行人）都被誤判為
  // 「待你處理」。改以 ApprovalRecord.expectedApproverUserId（唯一合格核准人時
  // 才有值，見 approvalService.pickExpectedApproverUserId）判斷；只有存在多位
  // 合格候選人（expectedApproverUserId 為 null，例如同團隊多位 LEAD）時，才退回
  // 用「LEAD 身分」做預覽近似——即使預覽近似判斷有誤，decideApprovalRecord 仍會
  // 在伺服端現場重新解析，deny-by-default，不構成授權漏洞，只影響畫面預覽準確度。
  let isEligible: boolean;
  if (currentStage.stageType === "APPROVAL") {
    if (pendingApprovalDecision !== "PENDING") {
      isEligible = false;
    } else if (pendingApprovalExpectedApproverUserId !== null) {
      isEligible = pendingApprovalExpectedApproverUserId === actorId;
    } else {
      const leadEligibility = await evaluateActorEligibilityForStage(
        prisma,
        actorId,
        { assignedTeamId },
        { requiredExecutionRole: null, requiredMembershipRole: "LEAD", stageKey: currentStage.stageKey },
      );
      isEligible = leadEligibility.eligible;
    }
  } else {
    const eligibility = await evaluateActorEligibilityForStage(
      prisma,
      actorId,
      { assignedTeamId },
      { requiredExecutionRole: null, requiredMembershipRole: currentStage.requiredMembershipRole, stageKey: currentStage.stageKey },
    );
    isEligible = eligibility.eligible;
  }

  const dwellDays = await computeDwellDays(issueId);
  const riskStatusLabel = await computeRiskStatusLabel(issueId);

  const primaryForward = availableTransitions.find((t) => t.transition.transitionType === "FORWARD");
  const nextBusinessStageLabel = primaryForward
    ? String(businessStageOf(primaryForward.transition.toStage.stageKey, primaryForward.transition.toStage.label))
    : null;

  const todoItems: HotfixTodoItem[] = [];
  for (const req of stageRequirements) {
    if (req.satisfied) continue;
    if (req.requirementType === "REQUIRE_FIELD") todoItems.push({ text: `尚未填寫「${fieldLabelOf(req.targetKey)}」`, anchor: `field-${req.targetKey}` });
    else if (req.requirementType === "REQUIRE_EVIDENCE") todoItems.push({ text: `尚缺${evidenceLabelOf(req.targetKey)}`, anchor: "evidence-section" });
    else if (req.requirementType === "REQUIRE_COMMENT") todoItems.push({ text: "尚無留言紀錄", anchor: "comment-section" });
    else todoItems.push({ text: req.message });
  }
  if (pendingApprovalDecision === "PENDING") {
    todoItems.push({ text: `尚未完成${responsibleRoleLabel}核准`, anchor: "approval-section" });
  }
  if (primaryForward) {
    todoItems.push(...(await riskCheckTodoForTargetStage(issueId, primaryForward.transition.toStage.stageKey)));
  }

  return {
    businessStageIndex,
    businessStageLabel: String(businessStageLabel),
    approvalBadge,
    responsibleTeamName: assignedTeamName,
    responsibleRoleLabel,
    isCurrentActorResponsible: isEligible,
    dwellDays,
    nextBusinessStageLabel,
    todoItems,
    riskStatusLabel,
  };
}

export { HOTFIX_BUSINESS_STAGES };
