// M2-B2 新增：Hotfix Workflow v1 建構器（依 Plan M2 第四節最終定案）。
//
// 本檔案只是「一組會呼叫既有 M2-A 服務層 API 來建立＋發布一份 Hotfix WorkflowDefinition」
// 的可重用函式，不是可直接對正式 dev.db 執行的一次性腳本——Plan 第十二節明確標注 M2-B2
// 是「回不了頭的分水嶺」，需要在對正式資料庫執行前另行取得明確確認；本輪批次自治僅在
// scratch／測試資料庫呼叫本函式以驗證建構與發布邏輯正確（見 scripts/m2_b-verify.ts），
// 不對 /workspaces/governance-tracker/prisma/dev.db 執行任何寫入。
//
// 關卡集合：HOTFIX_MAIN_STATES 原有 19 個關卡＋cancelled（CANCEL 專用終態），共 20 個
// WorkflowStage。FORWARD：19 個主路徑關卡中，除 draft（起始關卡，不需入邊）外，其餘 18
// 個關卡各有唯一 FORWARD 入邊，形成單一直線主路徑。RETURN：8 條（3 條 APPROVAL 關卡駁回
// 各自退回對應 WORK 關卡 + Plan 第四節 Category B/C 表列 5 條裁決性退回）。CANCEL：2 條
// （draft、pendingBusinessApproval 各一條，皆指向 cancelled）。
//
// Category A（團隊路由條件分支）：一律經過 Triage，即使唯一 Team 也不自動略過——
// hasUniqueRdMapping/hasUniqueQaMapping/hasUniqueOpMapping 完全不參與本建構器，FORWARD
// 主路徑固定「業務核准→RD Triage→RD Claim→...」，不提供跳過 Triage 的分支 Transition。

import {
  createWorkflowDefinition,
  createDraftVersion,
  addWorkflowStage,
  addWorkflowTransition,
  addWorkflowStageRequirement,
  publishWorkflowVersion,
  type CreateWorkflowDefinitionInput,
} from "../../src/lib/workflowService";

export interface BuildHotfixWorkflowV1Input {
  actorId: string;
  reasonCode: string;
  keySuffix?: string; // 供 verify script 每次執行使用不同 key，避免撞既有 unique 限制
}

export interface HotfixWorkflowV1StageKeys {
  draft: string;
  pendingBusinessApproval: string;
  pendingRdTriage: string;
  pendingRdClaim: string;
  rdInProgress: string;
  pendingRdLeadApproval: string;
  pendingQaTriage: string;
  pendingQaClaim: string;
  qaInProgress: string;
  pendingQaLeadApproval: string;
  pendingOpTriage: string;
  pendingOpClaim: string;
  opPreparing: string;
  pendingDeploymentApproval: string;
  opDeploying: string;
  opCompleted: string;
  pendingReporterConfirmation: string;
  reporterConfirming: string;
  closed: string;
  cancelled: string;
}

interface StageSpec {
  key: keyof HotfixWorkflowV1StageKeys;
  label: string;
  stageType: string;
  isStart?: boolean;
  isEnd?: boolean;
  terminalOutcome?: "COMPLETED" | "CANCELLED" | null;
  approvalType?: string | null;
  requiredMembershipRole?: "MEMBER" | "LEAD" | null;
}

// 主路徑順序即 HOTFIX_MAIN_STATES 原始順序（src/lib/hotfixWorkflow.ts），cancelled 額外附加於尾端。
const STAGE_SPECS: StageSpec[] = [
  { key: "draft", label: "草稿", stageType: "SUBMISSION", isStart: true },
  { key: "pendingBusinessApproval", label: "待業務核准", stageType: "APPROVAL", approvalType: "BUSINESS_APPROVAL" },
  { key: "pendingRdTriage", label: "待 RD 分流", stageType: "TRIAGE" },
  { key: "pendingRdClaim", label: "待 RD 認領", stageType: "CLAIM", requiredMembershipRole: "MEMBER" },
  { key: "rdInProgress", label: "RD 修正中", stageType: "WORK", requiredMembershipRole: "MEMBER" },
  { key: "pendingRdLeadApproval", label: "待 RD 主管核准", stageType: "APPROVAL", approvalType: "RD_LEAD_APPROVAL" },
  { key: "pendingQaTriage", label: "待 QA 分流", stageType: "TRIAGE" },
  { key: "pendingQaClaim", label: "待 QA 認領", stageType: "CLAIM", requiredMembershipRole: "MEMBER" },
  { key: "qaInProgress", label: "QA 驗證中", stageType: "WORK", requiredMembershipRole: "MEMBER" },
  { key: "pendingQaLeadApproval", label: "待 QA 主管核准", stageType: "APPROVAL", approvalType: "QA_LEAD_APPROVAL" },
  { key: "pendingOpTriage", label: "待 OP 分流", stageType: "TRIAGE" },
  { key: "pendingOpClaim", label: "待 OP 認領", stageType: "CLAIM", requiredMembershipRole: "MEMBER" },
  { key: "opPreparing", label: "OP 部署準備中", stageType: "WORK", requiredMembershipRole: "MEMBER" },
  { key: "pendingDeploymentApproval", label: "待部署核准", stageType: "APPROVAL", approvalType: "DEPLOYMENT_APPROVAL" },
  { key: "opDeploying", label: "部署執行中", stageType: "DEPLOYMENT", requiredMembershipRole: "MEMBER" },
  { key: "opCompleted", label: "部署已完成", stageType: "CONFIRMATION" },
  { key: "pendingReporterConfirmation", label: "待開單人確認", stageType: "CLAIM" },
  { key: "reporterConfirming", label: "開單人確認中", stageType: "CONFIRMATION" },
  { key: "closed", label: "結案", stageType: "CLOSURE", isEnd: true, terminalOutcome: "COMPLETED" },
  { key: "cancelled", label: "已取消", stageType: "CLOSURE", isEnd: true, terminalOutcome: "CANCELLED" },
];

// FORWARD 主路徑（18 條：19 個主路徑關卡中，除 draft 外其餘 18 個各有唯一入邊）。
const FORWARD_EDGES: Array<{ from: keyof HotfixWorkflowV1StageKeys; to: keyof HotfixWorkflowV1StageKeys; actionKey: string; label: string }> = [
  { from: "draft", to: "pendingBusinessApproval", actionKey: "submit", label: "送出待業務核准" },
  { from: "pendingBusinessApproval", to: "pendingRdTriage", actionKey: "businessApprove", label: "業務核准" },
  { from: "pendingRdTriage", to: "pendingRdClaim", actionKey: "rdAssign", label: "指派 RD 處理團隊" },
  { from: "pendingRdClaim", to: "rdInProgress", actionKey: "rdClaim", label: "RD 認領" },
  { from: "rdInProgress", to: "pendingRdLeadApproval", actionKey: "rdSubmit", label: "RD 送核" },
  { from: "pendingRdLeadApproval", to: "pendingQaTriage", actionKey: "rdLeadApprove", label: "RD 主管核准" },
  { from: "pendingQaTriage", to: "pendingQaClaim", actionKey: "qaAssign", label: "指派 QA 處理團隊" },
  { from: "pendingQaClaim", to: "qaInProgress", actionKey: "qaClaim", label: "QA 認領" },
  { from: "qaInProgress", to: "pendingQaLeadApproval", actionKey: "qaSubmit", label: "QA 送核" },
  { from: "pendingQaLeadApproval", to: "pendingOpTriage", actionKey: "qaLeadApprove", label: "QA 主管核准" },
  { from: "pendingOpTriage", to: "pendingOpClaim", actionKey: "opAssign", label: "指派 OP 處理團隊" },
  { from: "pendingOpClaim", to: "opPreparing", actionKey: "opClaim", label: "OP 認領" },
  { from: "opPreparing", to: "pendingDeploymentApproval", actionKey: "opSubmit", label: "OP 送核" },
  { from: "pendingDeploymentApproval", to: "opDeploying", actionKey: "opLeadApprove", label: "部署核准" },
  { from: "opDeploying", to: "opCompleted", actionKey: "opDeployComplete", label: "部署成功" },
  { from: "opCompleted", to: "pendingReporterConfirmation", actionKey: "reporterConfirmOpen", label: "開放開單人確認" },
  { from: "pendingReporterConfirmation", to: "reporterConfirming", actionKey: "reporterClaim", label: "開單人開始確認" },
  { from: "reporterConfirming", to: "closed", actionKey: "reporterClose", label: "確認完成，結案" },
];

// RETURN（9 條，reason 一律必填）：包含兩次 OP 主管決策各自的駁回路徑。
const RETURN_EDGES: Array<{ from: keyof HotfixWorkflowV1StageKeys; to: keyof HotfixWorkflowV1StageKeys; actionKey: string; label: string }> = [
  { from: "pendingRdLeadApproval", to: "rdInProgress", actionKey: "rdLeadReject", label: "RD 主管駁回" },
  { from: "pendingQaLeadApproval", to: "qaInProgress", actionKey: "qaLeadReject", label: "QA 主管駁回" },
  { from: "pendingDeploymentApproval", to: "opPreparing", actionKey: "opLeadReject", label: "部署核准駁回" },
  { from: "opCompleted", to: "opDeploying", actionKey: "opPostConfirmReject", label: "上版後主管確認駁回" },
  { from: "opDeploying", to: "opPreparing", actionKey: "opRollbackStart", label: "部署回滾" },
  { from: "reporterConfirming", to: "pendingOpTriage", actionKey: "reporterRejectConfirm", label: "開單人發現異常" },
  { from: "pendingOpTriage", to: "rdInProgress", actionKey: "opTriageNeedsRdFix", label: "OP 分流判定需 RD 修正" },
  // pendingOpTriage「判定需 QA 返工」：目標限定為 pendingOpTriage 在 FORWARD 主路徑上的
  // 祖先，M2-B2 於此明確指定固定目標為 qaInProgress（Plan 第十五節待拍板事項 1 已於此拍板）。
  { from: "pendingOpTriage", to: "qaInProgress", actionKey: "opTriageNeedsQaRework", label: "OP 分流判定需 QA 返工" },
  { from: "pendingBusinessApproval", to: "draft", actionKey: "businessReject", label: "業務駁回" },
];

const CANCEL_EDGES: Array<{ from: keyof HotfixWorkflowV1StageKeys; actionKey: string; label: string }> = [
  { from: "draft", actionKey: "cancelDraft", label: "取消（草稿階段）" },
  { from: "pendingBusinessApproval", actionKey: "cancelPendingBusinessApproval", label: "取消（待業務核准階段）" },
];

// 正式結構化表單即為 OP 流程紀錄，附件選填，不再以 REQUIRE_EVIDENCE 阻擋 OP 送核。
const REQUIREMENT_SPECS: Array<{ stage: keyof HotfixWorkflowV1StageKeys; requirementType: string; targetKey: string }> = [
  { stage: "rdInProgress", requirementType: "REQUIRE_FIELD", targetKey: "rdFixVersion" },
  { stage: "qaInProgress", requirementType: "REQUIRE_FIELD", targetKey: "qaTestResult" },
  { stage: "reporterConfirming", requirementType: "REQUIRE_COMMENT", targetKey: "ANY" },
];

export async function buildHotfixWorkflowV1(input: BuildHotfixWorkflowV1Input) {
  const suffix = input.keySuffix ?? "v1";
  const defInput: CreateWorkflowDefinitionInput = {
    key: `hotfix-workflow-${suffix}`,
    name: "Hotfix 標準流程",
    description: "Hotfix 正式九階段流程（20 個內部關卡／18 FORWARD／9 RETURN／2 CANCEL）",
    issueType: "Hotfix",
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
  for (const edge of CANCEL_EDGES) {
    await addWorkflowTransition({
      workflowVersionId: version.id,
      fromStageId: stageIds[edge.from],
      toStageId: stageIds["cancelled"],
      transitionType: "CANCEL",
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

  return { definition, version: published, stageIds: stageIds as unknown as HotfixWorkflowV1StageKeys };
}
