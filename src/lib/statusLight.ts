import { StatusLight } from "./constants";
import { isClosed, nextStatusOf } from "./workflow";
import { evaluateGateRules } from "./gateRules";

// 各工單類型、各關卡「目前等待哪個角色確認」的預設對照表
// 用於自動帶入 waitingRole，使用者/Seed 仍可覆寫
const WAITING_ROLE_MAP: Record<string, Record<string, string>> = {
  Hotfix: {
    rdFix: "RD",
    rdSelfTest: "RD",
    qaVerify: "QA",
    qaRelease: "QA",
    opDeploy: "OP",
    prodConfirm: "OP",
  },
  Incident: {
    initialImpact: "RD",
    rcaDecision: "PM",
    verifying: "QA",
  },
  RCA: {
    analyzing: "RD",
    verifying: "QA",
  },
  RiskException: {
    riskAssessment: "資安推動小組",
    pendingApproval: "DMS主管",
    verifying: "QA",
  },
  QaVerification: {
    testing: "QA",
    retesting: "QA",
    releaseDecision: "QA",
  },
  ChangeRelease: {
    releaseReview: "DMS主管",
    prodConfirm: "OP",
  },
  MonitoringInventory: {
    reviewing: "資安推動小組",
  },
  BackupRecoveryTest: {
    backupConfirming: "OP",
    verifying: "QA",
  },
};

export function suggestWaitingRole(issueType: string, status: string): string {
  return WAITING_ROLE_MAP[issueType]?.[status] ?? "";
}

export interface StatusLightInput {
  issueType: string;
  riskLevel: string;
  workflowStatus: string;
  dueDate: Date | null;
  waitingRole: string;
  needRca: boolean;
  needRiskException: boolean;
  alertLevel: string;
  firstResponseAt: Date | null;
  fields: Record<string, string>;
  evidenceCount: number;
  hasClosingComment: boolean;
}

export interface StatusLightResult {
  light: StatusLight;
  reason: string;
}

// 依 PRD 第十章邏輯計算狀態燈號
export function calculateStatusLight(input: StatusLightInput): StatusLightResult {
  const {
    issueType,
    riskLevel,
    workflowStatus,
    dueDate,
    waitingRole,
    needRca,
    needRiskException,
    alertLevel,
    firstResponseAt,
    fields,
    evidenceCount,
    hasClosingComment,
  } = input;

  // 1. 已結案 -> Gray
  if (isClosed(issueType, workflowStatus)) {
    return { light: "Gray", reason: "工單已結案" };
  }

  // 2. 已逾期且未結案 -> Red
  if (dueDate && dueDate.getTime() < Date.now()) {
    return { light: "Red", reason: "已超過到期日" };
  }

  // 3. 關卡卡控未通過（硬性阻擋）-> Red
  const nextStatus = nextStatusOf(issueType, workflowStatus) ?? workflowStatus;
  const gate = evaluateGateRules({
    issueType,
    riskLevel,
    currentStatus: workflowStatus,
    targetStatus: nextStatus,
    fields,
    needRca,
    needRiskException,
    evidenceCount,
    hasClosingComment,
  });
  if (gate.blockReasons.length > 0) {
    return { light: "Red", reason: gate.blockReasons[0] };
  }

  // 4. Monitoring Inventory，Critical 告警尚未完成首次回應 -> Red
  if (issueType === "MonitoringInventory" && alertLevel === "Critical" && !firstResponseAt) {
    return { light: "Red", reason: "Critical 告警尚未完成首次回應" };
  }

  // 5. 必要佐證缺漏且已到結案前關卡 -> Yellow
  if (gate.missingEvidence.length > 0) {
    return { light: "Yellow", reason: "缺少必要佐證資料，尚無法結案" };
  }

  // 6. 等待角色不為空 -> Blue
  if (waitingRole && waitingRole.trim() !== "") {
    return { light: "Blue", reason: `等待 ${waitingRole} 確認` };
  }

  // 7. 有待辦事項（必要欄位尚未完成）-> Yellow
  if (gate.missingFields.length > 0) {
    return { light: "Yellow", reason: `尚有待辦欄位：${gate.missingFields.join("、")}` };
  }

  // 8. 其餘 -> Green
  return { light: "Green", reason: "流程正常" };
}
