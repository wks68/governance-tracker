// RD/QA/OP 接單流程新增：Hotfix v1 stageKey（見 scripts/lib/buildHotfixWorkflowV1.ts）→
// 團隊領域（Team.domain，見 src/lib/constants.ts TeamDomain）固定對照表。
//
// 這是對「已知、有限、受控」的 stageKey 常數字串做的固定對照，不是依團隊名稱或任何自由
// 文字做的猜測——stageKey 集合由 buildHotfixWorkflowV1.ts 一次性建立，執行期不會出現新的
// stageKey。未來若有新 issueType／Workflow 需要接單機制，須另行擴充本表，不得反向從
// Team.name 或 Issue.systemName 推斷領域。
//
// Incident 事件通報流程新增：pendingIntake（見 scripts/lib/buildIncidentWorkflowV1.ts）
// 純新增一筆對照，沿用同一顆 claimService.claimIssueForTeam／listClaimableTeamsForStage
// 引擎，不建立第二套接單邏輯；不影響既有 Hotfix 三筆對照。

import type { TeamDomain } from "../constants";

// 可接單（TRIAGE）關卡 → 領域。只有這幾個關卡允許呼叫 claimService.claimIssueForTeam。
export const CLAIM_STAGE_DOMAIN: Record<string, TeamDomain> = {
  pendingRdTriage: "RD",
  pendingQaTriage: "QA",
  pendingOpTriage: "OP",
  pendingIntake: "INCIDENT",
};

// 指派執行人／執行人專屬可操作的關卡 → 領域。同一領域內的這些 stageKey 共用同一筆
// 「目前指派執行人」記錄（見 assignmentService.ts 的 IssueFieldValue 欄位），不會因為
// CLAIM→WORK／WORK→DEPLOYMENT 之間的關卡前進而重置——執行人在同一個 RD/QA/OP 輪次內
// 全程負責到送主管簽核為止。
export const EXECUTOR_SCOPE_STAGE_DOMAIN: Record<string, TeamDomain> = {
  pendingRdClaim: "RD",
  rdInProgress: "RD",
  pendingQaClaim: "QA",
  qaInProgress: "QA",
  pendingOpClaim: "OP",
  opPreparing: "OP",
  opDeploying: "OP",
  opCompleted: "OP",
};

export function getClaimDomainForStageKey(stageKey: string): TeamDomain | null {
  return CLAIM_STAGE_DOMAIN[stageKey] ?? null;
}

export function getExecutorDomainForStageKey(stageKey: string): TeamDomain | null {
  return EXECUTOR_SCOPE_STAGE_DOMAIN[stageKey] ?? null;
}

// IssueFieldValue.fieldKey 命名（沿用既有「動態欄位」延伸點，見 prisma/schema.prisma
// IssueFieldValue 註解與 requirementService.ts 既有 REQUIRE_FIELD 用法）。每個領域
// （RD/QA/OP）在同一張 Issue 上各自獨立一組，彼此不干擾（例如 RD 輪次的執行人記錄
// 不會被後續 QA 輪次的指派覆蓋）。
export function executorFieldKey(domain: TeamDomain): string {
  return `responsibility:${domain}:executorUserId`;
}
export function executorAssignedByFieldKey(domain: TeamDomain): string {
  return `responsibility:${domain}:assignedByUserId`;
}
export function executorAssignedAtFieldKey(domain: TeamDomain): string {
  return `responsibility:${domain}:assignedAt`;
}
