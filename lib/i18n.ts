export const AI_DISCLAIMER =
  "AI 建議為模擬輸出，請由流程負責人確認後再採用。";

const ISSUE_TYPE_LABELS: Record<string, string> = {
  Hotfix: "熱修復",
  Incident: "事件",
  RCA: "根因分析",
  "Risk Exception": "風險例外",
  "QA Verification": "QA 驗證",
  "Change / Release": "變更 / 發版",
  "Monitoring Inventory": "監控盤點",
  "Backup / Recovery Test": "備份 / 復原測試"
};

const WORKFLOW_STATUS_LABELS: Record<string, string> = {
  Submitted: "已提交",
  "Hotfix Review": "熱修復審查",
  "Impact Assessment": "影響評估",
  "RD Fixing": "RD 修復中",
  "RD Self-Test Done": "RD 自測完成",
  "QA Verifying": "QA 驗證中",
  "QA Approved": "QA 通過",
  "OP Releasing": "OP 發版中",
  "Production Confirming": "生產確認中",
  "Closure Review": "結案審查",
  Closed: "已關閉",
  Reported: "已通報",
  "Initial Assessment": "初步評估",
  "Initial Handling": "初步處置",
  "RCA Decision": "RCA 決策",
  "Improvement Tracking": "改善追蹤",
  Verification: "驗證中",
  Created: "已建立",
  Analyzing: "分析中",
  "Corrective Action": "矯正措施",
  "Preventive Action": "預防措施",
  Tracking: "追蹤中",
  Requested: "已申請",
  "Risk Review": "風險審查",
  "Pending Approval": "待核准",
  Approved: "已核准",
  Testing: "測試中",
  Retesting: "複測中",
  "Release Decision": "發版決策",
  "Release Review": "發版審查",
  Releasing: "發版中",
  "Production Confirmation": "生產確認",
  Draft: "草稿",
  Reviewing: "審查中",
  Active: "啟用中",
  "Need Update": "待更新",
  Planned: "已排程",
  "Backup Confirming": "備份確認",
  "Recovery Testing": "復原測試"
};

const STATUS_LIGHT_LABELS: Record<string, string> = {
  Red: "紅燈",
  Yellow: "黃燈",
  Blue: "藍燈",
  Green: "綠燈",
  Gray: "灰燈"
};

const ROLE_LABELS: Record<string, string> = {
  PM: "PM",
  RD: "RD",
  QA: "QA",
  OP: "OP",
  Security: "資安",
  "DMS Manager": "DMS 管理者",
  Admin: "管理員"
};

const ENVIRONMENT_LABELS: Record<string, string> = {
  Production: "生產",
  Staging: "測試暫存",
  UAT: "UAT",
  DR: "災難復原",
  Internal: "內部"
};

const RISK_LEVEL_LABELS: Record<string, string> = {
  Low: "低",
  Medium: "中",
  High: "高",
  Critical: "關鍵"
};

const PRIORITY_LABELS: Record<string, string> = {
  P1: "P1",
  P2: "P2",
  P3: "P3",
  P4: "P4"
};

const FIELD_LABELS: Record<string, string> = {
  Title: "標題",
  "System Name": "系統名稱",
  Environment: "環境",
  "Risk Level": "風險等級",
  Priority: "優先級",
  "Owner Role": "負責角色",
  "Owner Name": "負責人",
  Reporter: "回報人",
  "Due Date": "到期日",
  "Waiting Role": "等候角色",
  Description: "說明",
  "Issue Type": "議題類型",
  "Impact Scope": "影響範圍",
  "RD Fix Summary": "RD 修復摘要",
  "RD Self-Test Result": "RD 自測結果",
  "QA Result": "QA 結果",
  "Production Confirmation Result": "生產確認結果",
  "Incident Level": "事件等級",
  "Detection Time": "偵測時間",
  "Impacted Services": "受影響服務",
  "Initial Handling Result": "初步處置結果",
  "Root Cause Summary": "根因摘要",
  "Corrective Action": "矯正措施",
  "Preventive Action": "預防措施",
  "Verification Result": "驗證結果",
  "Risk Description": "風險說明",
  "Temporary Risk Reduction Measure": "暫時風險降低措施",
  "Follow-up Plan": "追蹤計畫",
  "Approval Role": "核准角色",
  "Test Items": "測試項目",
  "Release Decision Note": "發版決策備註",
  "Release Version": "發版版本",
  "Rollback Plan": "回復計畫",
  "Component Name": "元件名稱",
  "Monitoring Items": "監控項目",
  "Alert Level": "告警等級",
  "Alert Condition": "告警條件",
  "Notification Method": "通知方式",
  "Notification Target": "通知對象",
  "Log Location": "日誌位置",
  "Log Retention Days": "日誌保存天數",
  "First Response At": "首次回應時間",
  "Backup Result": "備份結果",
  "Recovery Result": "復原結果",
  "Backup Location": "備份位置",
  "Recovery Evidence": "復原佐證",
  Type: "類型",
  URL: "URL",
  Comment: "留言"
};

const OPTION_LABELS: Record<string, string> = {
  "": "請選擇",
  Passed: "通過",
  "Conditional Passed": "有條件通過",
  Failed: "失敗",
  Normal: "正常",
  Warning: "警示",
  Critical: "關鍵",
  Link: "連結",
  Deployment: "部署",
  Monitoring: "監控",
  Test: "測試",
  Inventory: "盤點",
  "Recovery Test": "復原測試",
  Missing: "缺少",
  Complete: "已完成"
};

const AI_SUGGESTION_LABELS: Record<string, string> = {
  "Generate Problem Summary": "產生問題摘要",
  "Suggest Impact Scope": "建議影響範圍",
  "Draft RCA": "草擬 RCA",
  "Suggest Corrective Action": "建議矯正措施",
  "Suggest Preventive Action": "建議預防措施",
  "Suggest Next Step": "建議下一步",
  "Check Missing Evidence": "檢查缺少佐證"
};

const ACTION_TYPE_LABELS: Record<string, string> = {
  "Seed Created": "種子資料建立",
  "Issue Created": "建立議題",
  "Issue Updated": "更新議題",
  "Transition Blocked": "流程轉換阻擋",
  "Workflow Transition": "流程轉換",
  "Comment Added": "新增留言",
  "Evidence Added": "新增佐證",
  "AI Suggestion Generated": "產生 AI 建議"
};

const FIELD_TYPE_LABELS: Record<string, string> = {
  text: "單行文字",
  textarea: "多行文字",
  select: "下拉選單",
  number: "數字",
  "datetime-local": "日期時間"
};

const GATE_ITEM_LABELS: Record<string, string> = {
  "At least one Evidence link or Closure Comment": "至少一筆佐證連結或結案留言",
  "QA Result is Failed, so OP Releasing is blocked.":
    "QA 結果為失敗，無法進入 OP 發版。",
  "QA Result must be Passed or Conditional Passed.":
    "QA 結果必須為通過或有條件通過。",
  "Conditional Passed requires Need Risk Exception.":
    "有條件通過需要勾選是否需要風險例外。",
  "High incident requires Need RCA.": "高等級事件需要勾選是否需要 RCA。",
  "Medium production-impact incident requires Need RCA.":
    "中等級且影響生產的事件需要勾選是否需要 RCA。",
  "High risk exception requires DMS Manager approval role.":
    "高風險例外需要 DMS 管理者核准角色。",
  "Failed QA Result cannot be closed.": "QA 結果失敗時不可結案。",
  "Backup Result is Failed, so status light must remain Red.":
    "備份結果失敗，燈號必須維持紅燈。",
  "Recovery Result is Failed; mark Need RCA or Need Risk Exception.":
    "復原結果失敗，請勾選是否需要 RCA 或風險例外。"
};

function lookup(map: Record<string, string>, value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  return map[value] ?? value;
}

export function displayIssueType(value: string | null | undefined): string {
  return lookup(ISSUE_TYPE_LABELS, value);
}

export function displayWorkflowStatus(value: string | null | undefined): string {
  return lookup(WORKFLOW_STATUS_LABELS, value);
}

export function displayStatusLight(value: string | null | undefined): string {
  return lookup(STATUS_LIGHT_LABELS, value);
}

export function displayRole(value: string | null | undefined): string {
  return lookup(ROLE_LABELS, value);
}

export function displayEnvironment(value: string | null | undefined): string {
  return lookup(ENVIRONMENT_LABELS, value);
}

export function displayRiskLevel(value: string | null | undefined): string {
  return lookup(RISK_LEVEL_LABELS, value);
}

export function displayPriority(value: string | null | undefined): string {
  return lookup(PRIORITY_LABELS, value);
}

export function displayFieldLabel(value: string | null | undefined): string {
  return lookup(FIELD_LABELS, value);
}

export function displayOption(value: string | null | undefined): string {
  return lookup(OPTION_LABELS, value);
}

export function displayEvidenceStatus(value: string | null | undefined): string {
  return lookup(OPTION_LABELS, value);
}

export function displayAiSuggestionType(value: string | null | undefined): string {
  return lookup(AI_SUGGESTION_LABELS, value);
}

export function displayActionType(value: string | null | undefined): string {
  return lookup(ACTION_TYPE_LABELS, value);
}

export function displayFieldType(value: string | null | undefined): string {
  return lookup(FIELD_TYPE_LABELS, value);
}

export function displayYesNo(value: boolean): string {
  return value ? "是" : "否";
}

export function displayGateItem(value: string): string {
  return GATE_ITEM_LABELS[value] ?? FIELD_LABELS[value] ?? value;
}

export function displayBlockReason(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  return value
    .split(";")
    .map((item) => displayGateItem(item.trim()))
    .filter(Boolean)
    .join("；");
}

export function displayNextStep(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  if (value === "Workflow is complete.") {
    return "流程已完成。";
  }

  if (value === "Resolve gate findings before moving forward.") {
    return "請先處理關卡檢查結果，再往下一步。";
  }

  const readyMatch = value.match(/^Ready for (.+)\.$/);
  if (readyMatch) {
    return `可進入「${displayWorkflowStatus(readyMatch[1])}」。`;
  }

  if (value === "Initial triage required.") {
    return "需要初步分流。";
  }

  return value;
}
