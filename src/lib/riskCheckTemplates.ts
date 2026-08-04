// M1.5-A 新增：RD／QA／OP 階段別固定影響檢核模板。
//
// 集中定義於此，checkKey 為固定值域，不得散落於 UI 元件內硬編碼。
// 送核前（rdSubmit／qaSubmit／opSubmit）由 approvalService.ts 檢查：
// 該 stageKey 底下所有 checkKey 必須存在、answer 均不得為 null，非模板 checkKey 一律拒絕。

export interface RiskCheckTemplateItem {
  checkKey: string;
  label: string;
}

// 對應 Hotfix 主流程送核關卡（見 src/lib/hotfixWorkflow.ts）。
export const RD_LEAD_APPROVAL_STAGE_KEY = "pendingRdLeadApproval";
export const QA_LEAD_APPROVAL_STAGE_KEY = "pendingQaLeadApproval";
export const DEPLOYMENT_APPROVAL_STAGE_KEY = "pendingDeploymentApproval";

const RD_RISK_CHECK_TEMPLATE: RiskCheckTemplateItem[] = [
  { checkKey: "involvesDatabase", label: "是否涉及資料庫（結構或資料）變更" },
  { checkKey: "involvesPermissionOrAuthentication", label: "是否涉及權限或身分驗證邏輯" },
  { checkKey: "affectsApiOrExternalSystem", label: "是否涉及 API 或外部系統介接" },
  { checkKey: "affectsBatchOrSchedule", label: "是否影響批次或排程作業" },
  { checkKey: "affectsSharedComponent", label: "是否影響共用元件或共用服務" },
  { checkKey: "involvesSensitiveOrPersonalData", label: "是否涉及機敏或個資資料" },
  { checkKey: "affectsLoggingOrMonitoring", label: "是否影響既有 Logging 或監控" },
  { checkKey: "hasUnknownDependency", label: "是否存在尚未釐清的相依風險" },
];

const QA_RISK_CHECK_TEMPLATE: RiskCheckTemplateItem[] = [
  { checkKey: "originalIssueResolved", label: "原始問題是否已確認解決" },
  { checkKey: "mainFunctionVerified", label: "主要功能是否已驗證" },
  { checkKey: "directRegressionVerified", label: "直接相關回歸是否已驗證" },
  { checkKey: "integrationVerified", label: "整合面（跨系統/跨模組）是否已驗證" },
  { checkKey: "dataAndPermissionVerified", label: "資料正確性與權限行為是否已驗證" },
  { checkKey: "testEnvironmentRepresentative", label: "測試環境是否具代表性" },
  { checkKey: "hasUntestedItems", label: "是否仍有未測試項目" },
  { checkKey: "hasUnknownRisk", label: "是否存在尚未釐清的風險" },
];

const OP_RISK_CHECK_TEMPLATE: RiskCheckTemplateItem[] = [
  { checkKey: "deploymentTargetConfirmed", label: "部署目標是否已確認" },
  { checkKey: "deploymentVersionConfirmed", label: "部署版本／Tag 是否已確認" },
  { checkKey: "databaseOrInfrastructureChangeConfirmed", label: "資料庫或基礎設施變更是否已確認" },
  { checkKey: "backupConfirmed", label: "備份是否已確認完成" },
  { checkKey: "rollbackPlanConfirmed", label: "回復計畫是否已確認" },
  { checkKey: "downtimeAndUserImpactConfirmed", label: "停機時間與使用者影響是否已確認" },
  { checkKey: "monitoringAndLoggingConfirmed", label: "監控與 Log 是否已確認就緒" },
  { checkKey: "hasUnknownDeploymentDependency", label: "是否存在尚未釐清的部署相依風險" },
];

export const RISK_CHECK_TEMPLATES: Record<string, RiskCheckTemplateItem[]> = {
  [RD_LEAD_APPROVAL_STAGE_KEY]: RD_RISK_CHECK_TEMPLATE,
  [QA_LEAD_APPROVAL_STAGE_KEY]: QA_RISK_CHECK_TEMPLATE,
  [DEPLOYMENT_APPROVAL_STAGE_KEY]: OP_RISK_CHECK_TEMPLATE,
};

export function getRiskCheckTemplate(stageKey: string): RiskCheckTemplateItem[] | null {
  return RISK_CHECK_TEMPLATES[stageKey] ?? null;
}

export function isValidCheckKeyForStage(stageKey: string, checkKey: string): boolean {
  const template = getRiskCheckTemplate(stageKey);
  if (!template) return false;
  return template.some((item) => item.checkKey === checkKey);
}
