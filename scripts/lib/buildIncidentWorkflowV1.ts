// Incident 事件通報流程 v1 建構器（比照 buildHotfixWorkflowV1.ts 既有慣例）。
//
// 只是「一組會呼叫既有 M2-A Workflow 服務層 API 建立＋發布一份 Incident WorkflowDefinition」
// 的可重用函式，不是可直接對正式 dev.db 執行的一次性腳本；scratch／測試資料庫呼叫本函式
// 驗證建構與發布邏輯正確（見 scripts/incident_workflow-verify.ts），不對正式 dev.db 寫入。
//
// 關卡集合：11 個granular WorkflowStage，對應正式九階段進度軸的 9 個業務階段（見
// src/lib/incident-ui/incidentStage.ts 的 stageKey → 業務階段對照，沿用 Hotfix nineStage.ts
// 「多個 granular stageKey 收斂成同一個業務階段」的既有慣例）：
//   1 事件通報                reported
//   2 承接與補件              pendingIntake
//   3 影響確認與分級          pendingClassification
//   4 指派處理單位            pendingUnitAssignment
//   5 技術主管接單與指派      pendingTechLeadClaim
//   6 初步處置與服務恢復      inHandling
//   7 恢復結果確認            pendingRecoveryConfirmation
//   8 RCA 啟動判定            pendingRcaDecision
//   9 事件結案／RCA 追蹤      pendingClosureConfirmation / closed
//
// 「需 RCA」不是獨立的 WorkflowStage 分支：Workflow 服務層每個關卡最多只允許一個 FORWARD
// Transition（addWorkflowTransition 的既有驗證規則），因此 pendingRcaDecision 只有唯一一條
// FORWARD 邊，一律前進到 pendingClosureConfirmation；「是否需要 RCA」與判定原因寫入
// IssueFieldValue（見 incidentAssignmentService.ts），並在需要 RCA 時作為「事件結案」動作
// 本身的一道額外關卡（RCA 未結案不得確認結案，畫面顯示「RCA 追蹤中」），而不是另一個必須
// 先行經過的 Stage。RCA 結案後自動或經確認關閉關聯事件的實際邏輯，屬於下一輪 RCA workflow
// 建構完成後才能定義的行為，本輪不臆測、不搭建半套邏輯。CANCEL 路徑本輪任務規格未描述，
// 同樣不建立。

import {
  createWorkflowDefinition,
  createDraftVersion,
  addWorkflowStage,
  addWorkflowTransition,
  addWorkflowStageRequirement,
  publishWorkflowVersion,
  type CreateWorkflowDefinitionInput,
} from "../../src/lib/workflowService";

export interface BuildIncidentWorkflowV1Input {
  actorId: string;
  reasonCode: string;
  keySuffix?: string;
}

export interface IncidentWorkflowV1StageKeys {
  reported: string;
  pendingIntake: string;
  pendingClassification: string;
  pendingUnitAssignment: string;
  pendingTechLeadClaim: string;
  inHandling: string;
  pendingRecoveryConfirmation: string;
  pendingRcaDecision: string;
  pendingClosureConfirmation: string;
  closed: string;
}

interface StageSpec {
  key: keyof IncidentWorkflowV1StageKeys;
  label: string;
  stageType: string;
  isStart?: boolean;
  isEnd?: boolean;
  terminalOutcome?: "COMPLETED" | "CANCELLED" | null;
  approvalType?: string | null;
  // 只有「責任團隊＝Issue.assignedTeamId」的關卡才設定（事件受理窗口全程負責，未再變動）；
  // 技術處理（pendingTechLeadClaim／inHandling）與資安推動小組（pendingRcaDecision）責任
  // 團隊另有其他解析方式（見 src/lib/incident-ui/incidentAssignmentService.ts），此欄留空。
  requiredMembershipRole?: "MEMBER" | "LEAD" | null;
}

const STAGE_SPECS: StageSpec[] = [
  { key: "reported", label: "事件通報", stageType: "SUBMISSION", isStart: true },
  // requiredMembershipRole 刻意留空：接單（claimIssueForTeam）與退回補件
  // （requestIncidentSupplement）在承接發生前都以「INCIDENT 領域團隊 LEAD」判斷資格，
  // Issue.assignedTeamId 此時仍是 null，不能用通用的 assignedTeamId 成員身分機制判斷
  // （見 incidentAssignmentService.ts 說明）。
  { key: "pendingIntake", label: "待承接與補件", stageType: "CLAIM" },
  { key: "pendingClassification", label: "影響確認與分級中", stageType: "WORK", requiredMembershipRole: "LEAD" },
  { key: "pendingUnitAssignment", label: "待指派處理單位", stageType: "WORK", requiredMembershipRole: "LEAD" },
  { key: "pendingTechLeadClaim", label: "待技術主管接單與指派", stageType: "CLAIM" },
  { key: "inHandling", label: "初步處置與服務恢復中", stageType: "WORK" },
  { key: "pendingRecoveryConfirmation", label: "待恢復結果確認", stageType: "REVIEW", requiredMembershipRole: "LEAD" },
  // 第二階段：改走正式 ApprovalRecord（approverTeamId 固定解析為 domain=SECURITY 團隊，
  // 見 src/lib/approvalService.ts 的 APPROVAL_TEAM_RESOLUTION_BY_DOMAIN），取代第一階段的
  // capability-gated 暫行實作，使資安推動小組的確認正式進入 Bell／待辦／核准歷程。
  { key: "pendingRcaDecision", label: "RCA 啟動判定中", stageType: "APPROVAL", approvalType: "INCIDENT_RCA_DECISION_CONFIRMATION" },
  { key: "pendingClosureConfirmation", label: "待事件結案確認", stageType: "APPROVAL", approvalType: "INCIDENT_CLOSURE_CONFIRMATION" },
  { key: "closed", label: "已結案", stageType: "CLOSURE", isEnd: true, terminalOutcome: "COMPLETED" },
];

const FORWARD_EDGES: Array<{ from: keyof IncidentWorkflowV1StageKeys; to: keyof IncidentWorkflowV1StageKeys; actionKey: string; label: string }> = [
  { from: "reported", to: "pendingIntake", actionKey: "submit", label: "送出待承接" },
  { from: "pendingIntake", to: "pendingClassification", actionKey: "intakeClaim", label: "受理窗口承接" },
  { from: "pendingClassification", to: "pendingUnitAssignment", actionKey: "classify", label: "完成影響確認與分級" },
  { from: "pendingUnitAssignment", to: "pendingTechLeadClaim", actionKey: "assignUnit", label: "指派處理單位" },
  { from: "pendingTechLeadClaim", to: "inHandling", actionKey: "techLeadClaim", label: "技術主管接單並指派" },
  { from: "inHandling", to: "pendingRecoveryConfirmation", actionKey: "submitHandling", label: "送出初步處置與恢復結果" },
  { from: "pendingRecoveryConfirmation", to: "pendingRcaDecision", actionKey: "confirmRecovery", label: "確認恢復結果" },
  { from: "pendingRcaDecision", to: "pendingClosureConfirmation", actionKey: "confirmRcaDecision", label: "資安推動小組完成 RCA 啟動判定" },
  { from: "pendingClosureConfirmation", to: "closed", actionKey: "confirmClosure", label: "確認事件結案" },
];

const RETURN_EDGES: Array<{ from: keyof IncidentWorkflowV1StageKeys; to: keyof IncidentWorkflowV1StageKeys; actionKey: string; label: string }> = [
  { from: "pendingIntake", to: "reported", actionKey: "requestSupplement", label: "退回補件" },
  { from: "pendingTechLeadClaim", to: "pendingUnitAssignment", actionKey: "techLeadReturn", label: "技術單位無法承接，退回重新指派" },
  { from: "pendingRecoveryConfirmation", to: "inHandling", actionKey: "recoveryRejected", label: "恢復結果未通過，退回處理" },
];

const REQUIREMENT_SPECS: Array<{ stage: keyof IncidentWorkflowV1StageKeys; requirementType: string; targetKey: string }> = [
  { stage: "pendingClassification", requirementType: "REQUIRE_FIELD", targetKey: "incidentFormalSeverity" },
  { stage: "inHandling", requirementType: "REQUIRE_FIELD", targetKey: "incidentRecoveryResult" },
];

export async function buildIncidentWorkflowV1(input: BuildIncidentWorkflowV1Input) {
  const suffix = input.keySuffix ?? "v1";
  const defInput: CreateWorkflowDefinitionInput = {
    key: `incident-workflow-${suffix}`,
    name: "事件通報流程",
    description: "Incident 事件通報九階段流程（10 個內部關卡／9 FORWARD／3 RETURN）",
    issueType: "Incident",
    actorId: input.actorId,
    reasonCode: input.reasonCode,
  };
  const definition = await createWorkflowDefinition(defInput);
  const version = await createDraftVersion({ workflowDefinitionId: definition.id, actorId: input.actorId, reasonCode: input.reasonCode });

  const stageIds: Record<string, string> = {};
  let sortOrder = 0;
  for (const spec of STAGE_SPECS) {
    const stage = await addWorkflowStage({
      workflowVersionId: version.id,
      stageKey: spec.key,
      label: spec.label,
      stageType: spec.stageType,
      sortOrder: sortOrder++,
      isStart: spec.isStart ?? false,
      isEnd: spec.isEnd ?? false,
      terminalOutcome: spec.terminalOutcome ?? null,
      requiredMembershipRole: spec.requiredMembershipRole ?? null,
      approvalType: spec.approvalType ?? null,
      actorId: input.actorId,
      reasonCode: input.reasonCode,
    });
    stageIds[spec.key] = stage.id;
  }

  for (const edge of FORWARD_EDGES) {
    await addWorkflowTransition({
      workflowVersionId: version.id,
      fromStageId: stageIds[edge.from],
      toStageId: stageIds[edge.to],
      transitionType: "FORWARD",
      actionKey: edge.actionKey,
      label: edge.label,
      requireReason: false,
      actorId: input.actorId,
      reasonCode: input.reasonCode,
    });
  }
  for (const edge of RETURN_EDGES) {
    await addWorkflowTransition({
      workflowVersionId: version.id,
      fromStageId: stageIds[edge.from],
      toStageId: stageIds[edge.to],
      transitionType: "RETURN",
      actionKey: edge.actionKey,
      label: edge.label,
      requireReason: true,
      actorId: input.actorId,
      reasonCode: input.reasonCode,
    });
  }

  for (const req of REQUIREMENT_SPECS) {
    await addWorkflowStageRequirement({
      workflowStageId: stageIds[req.stage],
      requirementType: req.requirementType,
      targetKey: req.targetKey,
      actorId: input.actorId,
      reasonCode: input.reasonCode,
    });
  }

  const published = await publishWorkflowVersion({ versionId: version.id, actorId: input.actorId, reasonCode: input.reasonCode });

  return { definition, version: published, stageIds: stageIds as unknown as IncidentWorkflowV1StageKeys };
}
