import { isClosed, statusLabel } from "./workflow";

export interface GateInput {
  issueType: string;
  riskLevel: string;
  currentStatus: string;
  targetStatus: string; // 欲進入的下一個關卡
  fields: Record<string, string>; // 動態欄位 key -> value（字串，checkbox 存 "true"/"false"）
  needRca: boolean;
  needRiskException: boolean;
  evidenceCount: number;
  hasClosingComment: boolean;
}

export interface GateResult {
  passed: boolean;
  missingFields: string[];
  missingEvidence: string[];
  blockReasons: string[];
  nextStep: string;
}

function isEmpty(v: string | undefined | null): boolean {
  return !v || v.trim() === "";
}

// 簡化版關卡卡控規則引擎，非完整規則引擎
export function evaluateGateRules(input: GateInput): GateResult {
  const { issueType, riskLevel, targetStatus, fields, needRca, needRiskException, evidenceCount, hasClosingComment } = input;
  const missingFields: string[] = [];
  const missingEvidence: string[] = [];
  const blockReasons: string[] = [];
  let nextStep = "";

  const require = (key: string, label: string) => {
    if (isEmpty(fields[key])) missingFields.push(label);
  };

  // ---- 各工單類型的關卡卡控 ----
  if (issueType === "Hotfix") {
    if (targetStatus === "rdSelfTest") {
      require("rdFixVersion", "修正版本 / Branch / Commit");
      const approval = fields["rdManagerApproval"];
      if (isEmpty(approval)) {
        missingFields.push("主管核准結果");
      } else if (approval === "不核准") {
        blockReasons.push("主管不核准，請確認修正內容後再送核");
      } else if (approval === "退回修正") {
        blockReasons.push("主管已退回修正，請依核准意見調整後再送核");
      }
    }
    if (targetStatus === "qaVerify") {
      require("rdSelfTestItems", "自測項目");
      require("rdTesterName", "RD");
      if (fields["rdSelfTestResult"] !== "true") {
        blockReasons.push("RD 自測尚未通過，請先完成自測並確認通過");
      }
    }
    if (targetStatus === "qaRelease") {
      require("qaTestItems", "測試項目");
      require("qaVerifyResult", "QA 驗證結果");
    }
    if (targetStatus === "opDeploy") {
      const result = fields["qaVerifyResult"];
      if (isEmpty(result)) {
        missingFields.push("QA 驗證結果");
      } else if (result === "未通過") {
        blockReasons.push("QA 驗證結果為未通過，不可進入 OP 上版");
      } else if (result === "有條件通過" && !needRiskException) {
        blockReasons.push("QA 驗證結果為有條件通過，需勾選「需要風險例外」");
      }
    }
    if (targetStatus === "prodConfirm") {
      require("opDeployResult", "部署結果");
      require("opPostCheckConclusion", "上線後確認結論");
      if (fields["opDeployResult"] === "未完成") {
        blockReasons.push("部署結果為未完成，不可進入正式環境確認");
      }
      if (fields["opPostCheckConclusion"] === "未通過") {
        blockReasons.push("上線後確認結論為未通過，不可進入正式環境確認");
      }
    }
  }

  if (issueType === "Incident") {
    if (targetStatus === "initialResponse") {
      require("incidentLevel", "事件等級");
    }
    if (targetStatus === "rcaDecision" || targetStatus === "initialResponse") {
      const level = fields["incidentLevel"];
      const impactProduction = fields["__impactProduction"] === "true";
      if (level === "高" && !needRca) {
        blockReasons.push("事件等級為高，必須勾選「需要 RCA」");
      }
      if (level === "中" && impactProduction && !needRca) {
        blockReasons.push("事件等級為中且影響正式環境，必須勾選「需要 RCA」");
      }
    }
    if (isClosed(issueType, targetStatus)) {
      require("initialResponseResult", "初步處置結果");
    }
  }

  if (issueType === "RCA") {
    if (targetStatus === "correctiveAction") {
      require("rootCauseAnalysis", "事件原因分析");
    }
    if (targetStatus === "verifying") {
      require("correctiveAction", "矯正措施");
      require("preventiveAction", "預防措施");
    }
    if (isClosed(issueType, targetStatus)) {
      require("verificationResult", "驗證結果");
    }
  }

  if (issueType === "RiskException") {
    if (targetStatus === "pendingApproval") {
      require("riskDescription", "風險說明");
      require("tempMitigation", "暫時風險降低措施");
      require("followUpPlan", "後續處理計畫");
    }
    if (targetStatus === "approved") {
      const approver = fields["approverRole"];
      if (isEmpty(approver)) {
        missingFields.push("核准角色");
      } else if (riskLevel === "高" && approver !== "DMS主管") {
        blockReasons.push("風險等級為高，核准角色必須是 DMS 主管");
      }
    }
    if (isClosed(issueType, targetStatus)) {
      require("verificationResult", "驗證結果");
    }
  }

  if (issueType === "QaVerification") {
    if (targetStatus === "releaseDecision") {
      require("testItems", "測試項目");
      require("qaVerifyResult", "QA 驗證結果");
    }
    if (isClosed(issueType, targetStatus)) {
      if (fields["qaVerifyResult"] === "未通過") {
        blockReasons.push("QA 驗證結果為未通過，不可結案");
      }
    }
  }

  if (issueType === "ChangeRelease") {
    if (targetStatus === "deploying") {
      require("releaseVersion", "上線版本");
      require("rollbackPlan", "回復計畫");
    }
    if (isClosed(issueType, targetStatus)) {
      require("prodConfirmResult", "正式環境確認結果");
    }
  }

  if (issueType === "MonitoringInventory") {
    if (targetStatus === "reviewing") {
      require("hostServiceComponent", "主機 / 服務 / 元件名稱");
      require("monitoringItem", "監控項目");
    }
    if (targetStatus === "active") {
      require("hostServiceComponent", "主機 / 服務 / 元件名稱");
      require("monitoringItem", "監控項目");
      require("notifyMethod", "通知方式");
      require("notifyTarget", "通知對象");
    }
    const retention = Number(fields["logRetentionDays"] || "0");
    if (retention > 0 && retention < 30) {
      nextStep = "日誌留存天數不足 30 天，建議調整保留政策";
    }
  }

  if (issueType === "BackupRecoveryTest") {
    if (targetStatus === "verifying") {
      require("backupResult", "備份結果");
    }
    if (fields["backupResult"] === "失敗") {
      blockReasons.push("備份結果為失敗，狀態燈號將標示為異常 / 逾期");
    }
    if (fields["recoveryResult"] === "失敗") {
      nextStep = "復原結果為失敗，建議建立 RCA 或風險例外";
    }
  }

  // ---- 通用規則：結案前必須至少有一筆佐證資料或一筆結案留言 ----
  if (isClosed(issueType, targetStatus)) {
    if (evidenceCount === 0 && !hasClosingComment) {
      missingEvidence.push("至少一筆佐證資料或一筆結案留言");
    }
  }

  const passed = missingFields.length === 0 && missingEvidence.length === 0 && blockReasons.length === 0;

  if (!nextStep) {
    if (!passed) {
      if (missingFields.length > 0) nextStep = `請先補齊欄位：${missingFields.join("、")}`;
      else if (missingEvidence.length > 0) nextStep = `請先補齊佐證：${missingEvidence.join("、")}`;
      else if (blockReasons.length > 0) nextStep = blockReasons[0];
    } else {
      nextStep = `可進入下一關卡：${statusLabel(issueType, targetStatus)}`;
    }
  }

  return { passed, missingFields, missingEvidence, blockReasons, nextStep };
}
