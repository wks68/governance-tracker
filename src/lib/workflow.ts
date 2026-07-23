import { IssueTypeKey } from "./constants";

// 每一種工單類型的流程關卡（依序）
export const WORKFLOWS: Record<IssueTypeKey, string[]> = {
  Hotfix: [
    "Hotfix已開單",
    "RD修正",
    "RD自測",
    "QA驗證",
    "QA放行確認",
    "OP上版",
    "正式環境確認",
    "結案確認",
  ],
  Incident: [
    "已通報",
    "初步影響判定",
    "初步處置中",
    "RCA判定",
    "改善追蹤",
    "驗證中",
    "已結案",
  ],
  RCA: [
    "已建立",
    "分析中",
    "矯正措施",
    "預防措施",
    "改善追蹤",
    "驗證中",
    "已結案",
  ],
  RiskException: [
    "例外申請",
    "風險評估",
    "待核准",
    "已核准",
    "追蹤中",
    "驗證中",
    "已結案",
  ],
  QaVerification: ["已建立", "測試中", "複測中", "放行判定", "已結案"],
  ChangeRelease: ["已建立", "上線審核", "上版中", "正式環境確認", "已結案"],
  MonitoringInventory: ["草稿", "審核中", "生效中", "需更新", "已結案"],
  BackupRecoveryTest: ["已規劃", "備份確認中", "復原測試中", "驗證中", "已結案"],
};

export const CLOSED_STATUS: Record<IssueTypeKey, string> = {
  Hotfix: "結案確認",
  Incident: "已結案",
  RCA: "已結案",
  RiskException: "已結案",
  QaVerification: "已結案",
  ChangeRelease: "已結案",
  MonitoringInventory: "已結案",
  BackupRecoveryTest: "已結案",
};

export function getWorkflow(issueType: string): string[] {
  return WORKFLOWS[issueType as IssueTypeKey] ?? [];
}

export function isClosed(issueType: string, status: string): boolean {
  return status === CLOSED_STATUS[issueType as IssueTypeKey];
}

export function currentStepIndex(issueType: string, status: string): number {
  return getWorkflow(issueType).indexOf(status);
}

export function nextStatusOf(issueType: string, status: string): string | null {
  const wf = getWorkflow(issueType);
  const idx = wf.indexOf(status);
  if (idx === -1 || idx >= wf.length - 1) return null;
  return wf[idx + 1];
}

export function prevStatusOf(issueType: string, status: string): string | null {
  const wf = getWorkflow(issueType);
  const idx = wf.indexOf(status);
  if (idx <= 0) return null;
  return wf[idx - 1];
}

// ---------------------------------------------------------------------------
// 動態欄位模板（依工單類型顯示不同欄位）
// ---------------------------------------------------------------------------

export type FieldType =
  | "text"
  | "textarea"
  | "select"
  | "checkbox" // 單一是/否
  | "number"
  | "date"
  | "datetime" // 日期＋時間
  | "radio" // 單選（畫面以清單方式呈現，對應紙本表單的 ☐ 單選清單）
  | "checkboxGroup"; // 複選（畫面以多個 checkbox 呈現，對應紙本表單可複選的 ☐ 清單）

export interface FieldTemplate {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  placeholder?: string;
  helpText?: string;
  // 此欄位在哪一個流程關卡才會顯示 / 可填寫；未設定則從建立工單當下就顯示
  stage?: string;
  // checkbox 專用：勾選時／未勾選時要顯示的文字（預設為「是」／「否」）
  checkboxTrueLabel?: string;
  checkboxFalseLabel?: string;
  // select 專用：選項改由指定角色的「已啟用」使用者名單動態帶入（由頁面元件查詢並傳入），取代靜態 options
  dynamicOptionsRole?: string;
}

export const FORM_TEMPLATES: Record<IssueTypeKey, FieldTemplate[]> = {
  Hotfix: [
    // ---- 建立工單時（Hotfix已開單）：不顯示任何動態欄位，僅填基本欄位 ----
    // ---- RD修正：進入此關卡才顯示 ----
    { key: "rdFixVersion", label: "修正版本 / Branch / Commit", type: "text", stage: "RD修正", helpText: "進入「RD自測」前必填" },
    {
      key: "rdManagerApproval",
      label: "主管核准結果",
      type: "radio",
      options: ["已於 Comment 核准", "不核准", "退回修正"],
      stage: "RD修正",
      helpText: "請先由主管於下方留言區留下核准意見，再選擇對應結果；進入「RD自測」前必填，選擇「不核准」或「退回修正」將無法推進",
    },

    // ---- RD自測：進入此關卡才顯示 ----
    {
      key: "rdSelfTestItems",
      label: "自測項目",
      type: "textarea",
      stage: "RD自測",
      placeholder: "請條列：1. 2. 3.",
      helpText: "進入「QA驗證」前必填；可使用右側「AI 輔助」產生草稿，如需附圖請於下方「佐證資料」貼上截圖連結",
    },
    {
      key: "rdSelfTestResult",
      label: "自測結果",
      type: "checkbox",
      checkboxTrueLabel: "通過",
      checkboxFalseLabel: "未通過",
      stage: "RD自測",
      helpText: "進入「QA驗證」前必填；未通過將無法推進",
    },
    {
      key: "rdTesterName",
      label: "RD",
      type: "select",
      dynamicOptionsRole: "RD",
      stage: "RD自測",
      helpText: "進入「QA驗證」前必填",
    },

    // ---- QA驗證：進入此關卡才顯示 ----
    { key: "qaTestItems", label: "測試項目", type: "textarea", stage: "QA驗證", helpText: "進入「QA放行確認」前必填" },
    {
      key: "qaVerifyResult",
      label: "QA 驗證結果",
      type: "select",
      options: ["通過", "有條件通過", "未通過"],
      stage: "QA驗證",
      helpText: "進入「QA放行確認」前必填，且不可為未通過才能進入「OP上版」",
    },

    // ---- OP上版：進入此關卡才顯示（DEI-DMS-PR18-F01 DMS 上線變更紀錄表）----
    // 一、上線前確認與回復（Rollback）計畫
    { key: "opNeedDowntime", label: "是否需停機或公告", type: "checkbox", stage: "OP上版" },
    { key: "opNeedDowntimeNote", label: "停機或公告說明", type: "text", stage: "OP上版" },
    {
      key: "opExpectedImpact",
      label: "預計影響",
      type: "checkboxGroup",
      options: ["無明顯影響", "需停機", "服務短暫中斷", "影響功能", "影響資料", "影響效能", "影響權限", "其他"],
      stage: "OP上版",
    },
    { key: "opExpectedImpactOther", label: "預計影響（其他說明）", type: "text", stage: "OP上版" },
    { key: "opImpactDurationMinutes", label: "預計影響時間（分鐘）", type: "number", stage: "OP上版", helpText: "無預計影響時間可留空" },
    { key: "opRollbackTrigger", label: "回復（Rollback）觸發條件", type: "text", stage: "OP上版" },
    { key: "opRollbackMethod", label: "回復（Rollback）方式", type: "text", stage: "OP上版" },
    { key: "opRollbackNotApplicable", label: "無法立即回復時之處置：不適用", type: "checkbox", stage: "OP上版" },
    { key: "opRollbackTempPlan", label: "無法立即回復時之臨時處置說明", type: "text", stage: "OP上版" },
    {
      key: "opPreApproval",
      label: "上線前核准結果",
      type: "radio",
      options: ["已由單位主管於 Comment 核准", "不核准上線", "條件式核准"],
      stage: "OP上版",
    },
    { key: "opPreApprovalNote", label: "條件式核准說明", type: "text", stage: "OP上版" },

    // 二、正式環境部署紀錄
    { key: "opActualStartTime", label: "實際開始時間", type: "datetime", stage: "OP上版" },
    { key: "opActualEndTime", label: "實際完成時間", type: "datetime", stage: "OP上版" },
    { key: "opDeployResult", label: "部署結果", type: "radio", options: ["完成", "未完成"], stage: "OP上版" },
    { key: "opDeployIssue", label: "異常與處置：有", type: "checkbox", stage: "OP上版" },
    { key: "opDeployIssueNote", label: "異常與處置說明", type: "text", stage: "OP上版" },
    { key: "opRollbackTriggered", label: "是否啟動回復（Rollback）", type: "checkbox", stage: "OP上版" },
    { key: "opRollbackResult", label: "回復（Rollback）結果", type: "text", stage: "OP上版" },

    // 三、上線後確認與結案
    { key: "opServiceStatus", label: "服務狀態確認", type: "radio", options: ["正常", "異常", "不適用"], stage: "OP上版" },
    { key: "opVersionCheck", label: "版本確認", type: "radio", options: ["正常", "異常", "不適用"], stage: "OP上版" },
    { key: "opFuncDataCheck", label: "功能 / 資料確認", type: "radio", options: ["正常", "異常", "不適用"], stage: "OP上版" },
    { key: "opLogMonitorCheck", label: "日誌 / 監控確認", type: "radio", options: ["正常", "異常", "不適用"], stage: "OP上版" },
    { key: "opPostCheckConclusion", label: "上線後確認結論", type: "radio", options: ["通過", "未通過", "不適用"], stage: "OP上版" },
    { key: "opFollowUp", label: "後續追蹤：有", type: "checkbox", stage: "OP上版" },
    { key: "opFollowUpNote", label: "後續追蹤說明", type: "text", stage: "OP上版" },
    { key: "opCloseResult", label: "結案結果", type: "radio", options: ["已完成", "已回復（Rollback）", "有後續追蹤"], stage: "OP上版" },
    { key: "opRemark", label: "備註", type: "textarea", stage: "OP上版" },
  ],
  Incident: [
    { key: "incidentLevel", label: "事件等級", type: "select", options: ["高", "中", "低"], helpText: "進入「初步處置中」前必填" },
    { key: "initialResponseResult", label: "初步處置結果", type: "textarea", helpText: "結案前必填" },
    { key: "needHotfix", label: "是否需 Hotfix", type: "checkbox" },
    { key: "needChangeRelease", label: "是否需變更 / 回復", type: "checkbox" },
  ],
  RCA: [
    { key: "rootCauseAnalysis", label: "事件原因分析", type: "textarea", helpText: "進入「矯正措施」前必填" },
    { key: "correctiveAction", label: "矯正措施", type: "textarea", helpText: "進入「驗證中」前必填" },
    { key: "preventiveAction", label: "預防措施", type: "textarea", helpText: "進入「驗證中」前必填" },
    { key: "verificationResult", label: "驗證結果", type: "textarea", helpText: "結案前必填" },
  ],
  RiskException: [
    { key: "exceptionReason", label: "例外原因", type: "textarea" },
    { key: "riskDescription", label: "風險說明", type: "textarea", helpText: "進入「待核准」前必填" },
    { key: "tempMitigation", label: "暫時風險降低措施", type: "textarea", helpText: "進入「待核准」前必填" },
    { key: "followUpPlan", label: "後續處理計畫", type: "textarea", helpText: "進入「待核准」前必填" },
    { key: "approverRole", label: "核准角色", type: "select", options: ["PM", "RD", "QA", "OP", "資安推動小組", "DMS主管"], helpText: "風險等級為高時，必須為 DMS 主管" },
    { key: "verificationResult", label: "驗證結果", type: "textarea", helpText: "結案前必填" },
  ],
  QaVerification: [
    { key: "testItems", label: "測試項目", type: "textarea", helpText: "進入「放行判定」前必填" },
    { key: "qaVerifyResult", label: "QA 驗證結果", type: "select", options: ["通過", "有條件通過", "未通過"], helpText: "進入「放行判定」前必填，未通過不可結案" },
  ],
  ChangeRelease: [
    { key: "releaseVersion", label: "上線版本", type: "text", helpText: "進入「上版中」前必填" },
    { key: "rollbackPlan", label: "回復計畫", type: "textarea", helpText: "進入「上版中」前必填" },
    { key: "prodConfirmResult", label: "正式環境確認結果", type: "textarea", helpText: "結案前必填" },
  ],
  MonitoringInventory: [
    { key: "hostServiceComponent", label: "主機 / 服務 / 元件名稱", type: "text" },
    { key: "monitoringItem", label: "監控項目", type: "text" },
    { key: "alertCondition", label: "告警條件", type: "textarea" },
    { key: "notifyMethod", label: "通知方式", type: "text", placeholder: "例如：Email、簡訊、MS Teams" },
    { key: "notifyTarget", label: "通知對象", type: "text" },
    { key: "logLocation", label: "日誌位置", type: "text" },
    { key: "logRetentionDays", label: "日誌留存天數", type: "number", helpText: "建議至少 30 天" },
  ],
  BackupRecoveryTest: [
    { key: "backupResult", label: "備份結果", type: "select", options: ["成功", "失敗"], helpText: "進入「驗證中」前必填；失敗時燈號將顯示 Red" },
    { key: "recoveryResult", label: "復原結果", type: "select", options: ["成功", "失敗", "未測試"], helpText: "失敗時建議建立 RCA 或風險例外" },
  ],
};

export function getFieldTemplate(issueType: string): FieldTemplate[] {
  return FORM_TEMPLATES[issueType as IssueTypeKey] ?? [];
}

// 只回傳「已經到達或超過目前關卡」的動態欄位（依 stage 卡控畫面顯示 / 可填寫範圍）
// 沒有設定 stage 的欄位視為建立工單當下就可見
export function getVisibleFieldTemplate(issueType: string, currentStatus: string): FieldTemplate[] {
  const template = getFieldTemplate(issueType);
  const workflowIdx = currentStepIndex(issueType, currentStatus);
  return template.filter((f) => {
    if (!f.stage) return true;
    const stageIdx = currentStepIndex(issueType, f.stage);
    if (stageIdx === -1) return true;
    return workflowIdx >= stageIdx;
  });
}
