// RCA（根因分析與改善結案）流程 v1 建構器，比照 buildHotfixWorkflowV1.ts／
// buildIncidentWorkflowV1.ts 既有慣例。RCA 只能由 Incident「需要 RCA」判定建立
// （見 src/lib/incident-ui/rcaCreation.ts），不提供任意新增／空白 RCA 入口。
//
// 12 個內部 WorkflowStage，對應正式十二階段進度軸（見 src/lib/rca-ui/rcaStage.ts）：
//   1  建立 RCA                    rcaCreated
//   2  RCA 負責單位主管承接         pendingRcaTeamClaim
//   3  指派 RCA 主責人              pendingRcaOwnerAssignment
//   4  根因分析與改善計畫           rcaAnalysisInProgress
//   5  負責單位主管技術審查         pendingTechnicalReview
//   6  資安推動小組完整性審查       pendingSecurityIntegrityReview
//   7  條件式管理階層確認           pendingManagementConfirmation
//   8  改善措施執行                 improvementInProgress
//   9  改善佐證提交                 pendingImprovementEvidence
//   10 專業驗證與資安確認           pendingVerificationConfirmation
//   11 RCA 結案                    pendingRcaClosureConfirmation
//   12 關聯事件結案                 rcaClosed
//
// RCA 建立時 Issue.assignedTeamId 直接帶入來源 Incident 的技術處理團隊（見
// rcaCreation.ts），因此關卡 2（承接）与既有 Hotfix「已接單待指派」CLAIM 關卡同一種模式
// （團隊已知，只是 LEAD 尚未正式承接／指派主責人），不是 TRIAGE 式的「團隊尚未指定」。
//
// 條件式管理階層確認（stage 7）不是兩個一定會經過的獨立 WorkflowStage：低／中等級且不符合
// 任一額外條件時應直接略過送審，若因此拆成「一定要進、一定要走」的兩個 Stage 反而會強迫
// 每筆 RCA 都停在副部長／部長關卡等待一個「不適用」的人工操作。因此 stage 7 是單一 REVIEW
// 型別關卡，由 src/lib/workflow-execution/rcaManagementReviewService.ts 判斷是否需要送審，
// 需要時在同一關卡內動態建立 RCA_VP_CONFIRMATION／RCA_DIRECTOR_APPROVAL 兩筆 ApprovalRecord
// （不透過 stage 進入時的自動建立機制，因為是否需要、需要幾筆都是條件式的），全部核准通過
// （或判定不適用）後才前進到 stage 8；此設計不影響 stage 5／6／10／11 沿用既有
// 「進入 APPROVAL 型別關卡自動建立 ApprovalRecord」通用機制。

import {
  createWorkflowDefinition,
  createDraftVersion,
  addWorkflowStage,
  addWorkflowTransition,
  publishWorkflowVersion,
  type CreateWorkflowDefinitionInput,
} from "../../src/lib/workflowService";

export interface BuildRcaWorkflowV1Input {
  actorId: string;
  reasonCode: string;
  keySuffix?: string;
}

export interface RcaWorkflowV1StageKeys {
  rcaCreated: string;
  pendingRcaTeamClaim: string;
  pendingRcaOwnerAssignment: string;
  rcaAnalysisInProgress: string;
  pendingTechnicalReview: string;
  pendingSecurityIntegrityReview: string;
  pendingManagementConfirmation: string;
  improvementInProgress: string;
  pendingImprovementEvidence: string;
  pendingVerificationConfirmation: string;
  pendingRcaClosureConfirmation: string;
  rcaClosed: string;
}

interface StageSpec {
  key: keyof RcaWorkflowV1StageKeys;
  label: string;
  stageType: string;
  isStart?: boolean;
  isEnd?: boolean;
  terminalOutcome?: "COMPLETED" | "CANCELLED" | null;
  approvalType?: string | null;
  requiredMembershipRole?: "MEMBER" | "LEAD" | null;
}

const STAGE_SPECS: StageSpec[] = [
  { key: "rcaCreated", label: "建立 RCA", stageType: "SUBMISSION", isStart: true },
  { key: "pendingRcaTeamClaim", label: "待負責單位主管承接", stageType: "CLAIM", requiredMembershipRole: "LEAD" },
  { key: "pendingRcaOwnerAssignment", label: "待指派 RCA 主責人", stageType: "WORK", requiredMembershipRole: "LEAD" },
  // requiredMembershipRole 留空：責任人是「RCA 主責人」本人（IssueFieldValue 記錄），
  // 不是整個負責單位團隊，比照 Incident inHandling 的 executor 模式，見
  // rcaAssignmentService.ts 的 requireRcaOwner。
  { key: "rcaAnalysisInProgress", label: "根因分析與改善計畫中", stageType: "WORK" },
  { key: "pendingTechnicalReview", label: "待負責單位主管技術審查", stageType: "APPROVAL", approvalType: "RCA_TECHNICAL_REVIEW", requiredMembershipRole: "LEAD" },
  { key: "pendingSecurityIntegrityReview", label: "待資安推動小組完整性審查", stageType: "APPROVAL", approvalType: "RCA_SECURITY_INTEGRITY_REVIEW" },
  { key: "pendingManagementConfirmation", label: "條件式管理階層確認中", stageType: "REVIEW" },
  { key: "improvementInProgress", label: "改善措施執行中", stageType: "WORK" },
  { key: "pendingImprovementEvidence", label: "待改善佐證提交", stageType: "WORK" },
  { key: "pendingVerificationConfirmation", label: "待專業驗證與資安確認", stageType: "APPROVAL", approvalType: "RCA_SECURITY_VERIFICATION_CONFIRMATION" },
  { key: "pendingRcaClosureConfirmation", label: "待 RCA 結案確認", stageType: "APPROVAL", approvalType: "RCA_CLOSURE_CONFIRMATION", requiredMembershipRole: "LEAD" },
  { key: "rcaClosed", label: "RCA 已結案", stageType: "CLOSURE", isEnd: true, terminalOutcome: "COMPLETED" },
];

const FORWARD_EDGES: Array<{ from: keyof RcaWorkflowV1StageKeys; to: keyof RcaWorkflowV1StageKeys; actionKey: string; label: string }> = [
  { from: "rcaCreated", to: "pendingRcaTeamClaim", actionKey: "submit", label: "送出待承接" },
  { from: "pendingRcaTeamClaim", to: "pendingRcaOwnerAssignment", actionKey: "rcaTeamClaim", label: "負責單位主管承接" },
  { from: "pendingRcaOwnerAssignment", to: "rcaAnalysisInProgress", actionKey: "assignOwner", label: "指派 RCA 主責人" },
  { from: "rcaAnalysisInProgress", to: "pendingTechnicalReview", actionKey: "submitAnalysis", label: "送出根因分析與改善計畫" },
  { from: "pendingTechnicalReview", to: "pendingSecurityIntegrityReview", actionKey: "technicalReviewApprove", label: "技術審查通過" },
  { from: "pendingSecurityIntegrityReview", to: "pendingManagementConfirmation", actionKey: "securityIntegrityApprove", label: "完整性審查通過" },
  { from: "pendingManagementConfirmation", to: "improvementInProgress", actionKey: "managementConfirmProceed", label: "管理階層確認完成，進入改善執行" },
  { from: "improvementInProgress", to: "pendingImprovementEvidence", actionKey: "submitImprovementProgress", label: "改善措施執行完畢，待提交佐證" },
  { from: "pendingImprovementEvidence", to: "pendingVerificationConfirmation", actionKey: "submitEvidence", label: "送出改善佐證" },
  { from: "pendingVerificationConfirmation", to: "pendingRcaClosureConfirmation", actionKey: "verificationApprove", label: "驗證與佐證完整性確認通過" },
  { from: "pendingRcaClosureConfirmation", to: "rcaClosed", actionKey: "confirmRcaClosure", label: "確認 RCA 結案" },
];

const RETURN_EDGES: Array<{ from: keyof RcaWorkflowV1StageKeys; to: keyof RcaWorkflowV1StageKeys; actionKey: string; label: string }> = [
  { from: "pendingTechnicalReview", to: "rcaAnalysisInProgress", actionKey: "technicalReviewReject", label: "技術審查退回補正" },
  { from: "pendingSecurityIntegrityReview", to: "rcaAnalysisInProgress", actionKey: "securityIntegrityReject", label: "完整性審查退回補正" },
  { from: "pendingVerificationConfirmation", to: "improvementInProgress", actionKey: "verificationReject", label: "驗證不通過，退回改善責任人重新處理" },
];

export async function buildRcaWorkflowV1(input: BuildRcaWorkflowV1Input) {
  const suffix = input.keySuffix ?? "v1";
  const defInput: CreateWorkflowDefinitionInput = {
    key: `rca-workflow-${suffix}`,
    name: "RCA 根因分析與改善結案流程",
    description: "RCA 正式十二階段流程（12 個內部關卡／11 FORWARD／3 RETURN）",
    issueType: "RCA",
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

  const published = await publishWorkflowVersion({ versionId: version.id, actorId: input.actorId, reasonCode: input.reasonCode });

  return { definition, version: published, stageIds: stageIds as unknown as RcaWorkflowV1StageKeys };
}
