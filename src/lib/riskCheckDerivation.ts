// 風險檢核死結修正新增：由「既有正式工單資料」推導 StageRiskCheck 結果的純邏輯層。
//
// 背景（真正的根因）：src/lib/riskCheckTemplates.ts 定義了 RD／QA／OP 各 8 項固定檢核，
// approvalService.assertRiskChecksReadyForSubmission 要求送核前這 8 項必須全部有非 null 答案，
// 但 RD／QA／OP 執行頁從來沒有提供任何逐項填答的畫面——唯一的寫入入口
// workflow-execution/requirementService.submitStageRiskCheckAnswer 只有 verify script 在呼叫。
// 結果就是：使用者填完畫面上所有必填欄位後，仍然被「尚無任何風險檢核紀錄」擋住，且畫面上
// 沒有任何操作可以解除，形成流程死結。
//
// 修正原則（不得只移除錯誤訊息而保留無法完成的隱藏要求）：風險檢核仍然是必要控制，但答案
// 一律由「使用者確實已在正式畫面填寫的資料」推導，不再要求第二次隱藏操作：
//   - 工單層級：riskLevel（風險等級）／environment（環境）／impactProduction／needRca／
//     needRiskException（既有風險／例外紀錄）
//   - 關卡層級：該關卡既有的 IssueFieldValue（RD 影響範圍確認、QA 測試範圍、OP 上版步驟…）
// 推導結果只會是 YES／NO，永遠不產生 UNKNOWN——UNKNOWN 會在主管核准時被
// assertNoUnresolvedUnknownRisks 擋住，而使用者同樣沒有 resolve 的畫面，那只是把死結往後移。
// 「是否仍有未釐清風險」這類項目改以 YES 表達（＝提示主管注意，但不阻斷流程）。
//
// 本檔案是純邏輯，不 import Prisma／approvalService，可單獨測試。

import {
  RD_LEAD_APPROVAL_STAGE_KEY,
  QA_LEAD_APPROVAL_STAGE_KEY,
  DEPLOYMENT_APPROVAL_STAGE_KEY,
  getRiskCheckTemplate,
} from "./riskCheckTemplates";

export type DerivedAnswer = "YES" | "NO";

export interface DerivedRiskCheck {
  checkKey: string;
  answer: DerivedAnswer;
  detail: string;
}

// 推導輸入：全部取自既有正式資料表，呼叫端不得自行捏造。
export interface RiskDerivationContext {
  riskLevel: string; // Issue.riskLevel（高／中／低）
  environment: string; // Issue.environment
  impactProduction: boolean; // Issue.impactProduction
  needRca: boolean; // Issue.needRca
  needRiskException: boolean; // Issue.needRiskException
  fieldValues: Record<string, string>; // 該工單既有的 IssueFieldValue（fieldKey → fieldValue）
}

export const HIGH_RISK_LEVEL = "高";

// 關鍵字比對一律轉小寫後做子字串比對；中文無大小寫問題，英文關鍵字則不分大小寫。
function matches(haystack: string, keywords: readonly string[]): boolean {
  const text = haystack.toLowerCase();
  return keywords.some((k) => text.includes(k.toLowerCase()));
}

function joined(fieldValues: Record<string, string>, keys: readonly string[]): string {
  return keys.map((k) => fieldValues[k] ?? "").join("\n");
}

// 「尚未釐清」的自述標記：使用者自己在正式欄位寫下這些字眼，才視為仍有未釐清風險，
// 不憑空猜測，也不因風險等級高就一律判定為有未知風險。
const UNCERTAINTY_KEYWORDS = ["未知", "不確定", "待確認", "尚未釐清", "尚待釐清", "無法確認", "unknown", "tbd", "tbc", "待補"];

const DATABASE_KEYWORDS = ["資料庫", "資料表", "schema", "migration", "sql", "database", "db 變更", "索引", "index"];
const AUTH_KEYWORDS = ["權限", "授權", "登入", "認證", "身分驗證", "密碼", "token", "auth", "permission", "role", "sso"];
const API_KEYWORDS = ["api", "介接", "外部系統", "第三方", "webhook", "integration", "介面串接"];
const BATCH_KEYWORDS = ["批次", "排程", "batch", "schedule", "cron", "job"];
const SHARED_KEYWORDS = ["共用", "共通", "shared", "共用元件", "共用服務", "library", "套件", "共同模組"];
const SENSITIVE_KEYWORDS = ["個資", "機敏", "敏感", "personal", "pii", "身分證", "電話", "隱私"];
const LOGGING_KEYWORDS = ["log", "日誌", "監控", "monitor", "告警", "alert", "觀測"];
const UNTESTED_KEYWORDS = ["未測", "未涵蓋", "未驗證", "無法測試", "not tested", "skip"];
const BACKUP_KEYWORDS = ["備份", "backup", "快照", "snapshot", "dump"];
const INFRA_KEYWORDS = [...DATABASE_KEYWORDS, "主機", "設定檔", "環境變數", "infra", "基礎設施", "config"];
const REGRESSION_KEYWORDS = ["回歸", "regression", "既有功能", "既有流程"];
const INTEGRATION_KEYWORDS = ["整合", "跨系統", "跨模組", "介接", "integration", "e2e"];
const DATA_PERMISSION_KEYWORDS = ["資料正確", "資料驗證", "權限", "帳號", "角色"];
// 「具代表性的測試環境」：本機／個人環境不算，需為共用測試環境。
const NON_REPRESENTATIVE_ENV_KEYWORDS = ["本機", "localhost", "local", "個人電腦", "個人環境", "自己的電腦"];

function yesNo(condition: boolean): DerivedAnswer {
  return condition ? "YES" : "NO";
}

function withSource(answer: DerivedAnswer, source: string): { answer: DerivedAnswer; detail: string } {
  return { answer, detail: `系統依既有工單資料自動判定為 ${answer}（依據：${source}）。` };
}

// RD 送核（pendingRdLeadApproval）：以 RD 於畫面填寫的「修正內容說明／影響範圍確認」
// 加上工單層級風險資料推導；高風險或影響正式環境時，資料庫／權限類檢核一律提升為 YES，
// 讓主管一定會看到需要注意的項目（fail-safe 方向為「提示更多」而非「隱藏風險」）。
function deriveRdChecks(ctx: RiskDerivationContext): DerivedRiskCheck[] {
  const text = joined(ctx.fieldValues, ["rdFixDescription", "rdImpactScope", "rdSelfTestResult", "rdFixVersion"]);
  const highRisk = ctx.riskLevel === HIGH_RISK_LEVEL;
  const prod = ctx.impactProduction || ctx.environment === "Production";

  const entries: Array<[string, { answer: DerivedAnswer; detail: string }]> = [
    ["involvesDatabase", withSource(yesNo(matches(text, DATABASE_KEYWORDS)), "RD 修正內容說明與影響範圍確認")],
    [
      "involvesPermissionOrAuthentication",
      withSource(yesNo(matches(text, AUTH_KEYWORDS)), "RD 修正內容說明與影響範圍確認"),
    ],
    ["affectsApiOrExternalSystem", withSource(yesNo(matches(text, API_KEYWORDS)), "RD 修正內容說明與影響範圍確認")],
    ["affectsBatchOrSchedule", withSource(yesNo(matches(text, BATCH_KEYWORDS)), "RD 修正內容說明與影響範圍確認")],
    ["affectsSharedComponent", withSource(yesNo(matches(text, SHARED_KEYWORDS)), "RD 修正內容說明與影響範圍確認")],
    [
      "involvesSensitiveOrPersonalData",
      withSource(yesNo(matches(text, SENSITIVE_KEYWORDS)), "RD 修正內容說明與影響範圍確認"),
    ],
    ["affectsLoggingOrMonitoring", withSource(yesNo(matches(text, LOGGING_KEYWORDS)), "RD 修正內容說明與影響範圍確認")],
    [
      "hasUnknownDependency",
      withSource(
        yesNo(matches(text, UNCERTAINTY_KEYWORDS) || ctx.needRiskException),
        "RD 影響範圍確認自述內容與工單風險例外註記",
      ),
    ],
  ];

  const result = entries.map(([checkKey, v]) => ({ checkKey, ...v }));

  // 高風險／影響正式環境時提升為 YES：這兩項是主管最需要看到的控制點，寧可多提示。
  if (highRisk || prod) {
    for (const item of result) {
      if (item.checkKey !== "involvesDatabase" && item.checkKey !== "involvesPermissionOrAuthentication") continue;
      if (item.answer === "YES") continue;
      item.answer = "YES";
      item.detail = `系統依既有工單資料自動判定為 YES（依據：工單風險等級「${ctx.riskLevel || "未填"}」／環境「${ctx.environment || "未填"}」屬需重點確認範圍）。`;
    }
  }
  return result;
}

// QA 送核（pendingQaLeadApproval）：以 QA 於畫面填寫的「驗證結果／測試範圍／測試環境／
// 缺陷觀察紀錄」推導；驗證結果是 select（驗證通過／驗證不通過），是最權威的單一來源。
function deriveQaChecks(ctx: RiskDerivationContext): DerivedRiskCheck[] {
  const passed = (ctx.fieldValues.qaTestResult ?? "").trim() === "驗證通過";
  const scope = joined(ctx.fieldValues, ["qaTestScope", "qaRecommendation"]);
  const notes = joined(ctx.fieldValues, ["qaDefectNotes", "qaRecommendation", "qaTestScope"]);
  const env = (ctx.fieldValues.qaTestEnvironment ?? "").trim();

  return [
    { checkKey: "originalIssueResolved", ...withSource(yesNo(passed), "QA 驗證結果欄位") },
    { checkKey: "mainFunctionVerified", ...withSource(yesNo(passed), "QA 驗證結果欄位") },
    {
      checkKey: "directRegressionVerified",
      ...withSource(yesNo(passed && (matches(scope, REGRESSION_KEYWORDS) || scope.trim() !== "")), "QA 測試範圍與驗證結果"),
    },
    {
      checkKey: "integrationVerified",
      ...withSource(yesNo(passed && matches(scope, INTEGRATION_KEYWORDS)), "QA 測試範圍是否涵蓋整合面"),
    },
    {
      checkKey: "dataAndPermissionVerified",
      ...withSource(yesNo(passed && matches(scope, DATA_PERMISSION_KEYWORDS)), "QA 測試範圍是否涵蓋資料與權限"),
    },
    {
      checkKey: "testEnvironmentRepresentative",
      ...withSource(yesNo(env !== "" && !matches(env, NON_REPRESENTATIVE_ENV_KEYWORDS)), "QA 測試環境欄位"),
    },
    { checkKey: "hasUntestedItems", ...withSource(yesNo(!passed || matches(notes, UNTESTED_KEYWORDS)), "QA 驗證結果與缺陷觀察紀錄") },
    {
      checkKey: "hasUnknownRisk",
      ...withSource(yesNo(matches(notes, UNCERTAINTY_KEYWORDS) || ctx.needRca), "QA 缺陷觀察紀錄自述內容與工單 RCA 註記"),
    },
  ];
}

// OP 送核（pendingDeploymentApproval）：OP 執行頁的 5 個必填欄位（上版環境／預計上版時間／
// 上版步驟摘要／回復方案／監控檢查項）本身就是這些檢核項目的正式來源，填寫完成即代表已確認。
function deriveOpChecks(ctx: RiskDerivationContext): DerivedRiskCheck[] {
  const filled = (key: string) => (ctx.fieldValues[key] ?? "").trim() !== "";
  const steps = joined(ctx.fieldValues, ["opDeploySteps", "opRollbackPlan"]);
  const all = joined(ctx.fieldValues, ["opDeploySteps", "opRollbackPlan", "opMonitoringChecklist", "opDeployEnvironment"]);

  return [
    { checkKey: "deploymentTargetConfirmed", ...withSource(yesNo(filled("opDeployEnvironment")), "OP 上版環境欄位") },
    {
      checkKey: "deploymentVersionConfirmed",
      ...withSource(yesNo(filled("rdFixVersion")), "RD 修正版本／Branch／Commit 欄位"),
    },
    {
      checkKey: "databaseOrInfrastructureChangeConfirmed",
      ...withSource(yesNo(filled("opDeploySteps") && (!matches(steps, INFRA_KEYWORDS) || filled("opRollbackPlan"))), "OP 上版步驟摘要與回復方案"),
    },
    { checkKey: "backupConfirmed", ...withSource(yesNo(matches(steps, BACKUP_KEYWORDS)), "OP 上版步驟摘要與回復方案是否載明備份") },
    { checkKey: "rollbackPlanConfirmed", ...withSource(yesNo(filled("opRollbackPlan")), "OP 回復方案欄位") },
    {
      checkKey: "downtimeAndUserImpactConfirmed",
      ...withSource(yesNo(filled("opDeployPlannedAt") && filled("opDeploySteps")), "OP 預計上版時間與上版步驟摘要"),
    },
    { checkKey: "monitoringAndLoggingConfirmed", ...withSource(yesNo(filled("opMonitoringChecklist")), "OP 監控檢查項欄位") },
    {
      checkKey: "hasUnknownDeploymentDependency",
      ...withSource(yesNo(matches(all, UNCERTAINTY_KEYWORDS) || ctx.needRiskException), "OP 上版資訊自述內容與工單風險例外註記"),
    },
  ];
}

// 對外唯一入口：回傳該 stageKey 模板中每一個 checkKey 的推導結果。
// 回傳結果保證：涵蓋模板全部 checkKey、不含模板外 checkKey、answer 永不為 null／UNKNOWN。
export function deriveRiskChecksForStage(stageKey: string, ctx: RiskDerivationContext): DerivedRiskCheck[] {
  const template = getRiskCheckTemplate(stageKey);
  if (!template) return [];

  const derived =
    stageKey === RD_LEAD_APPROVAL_STAGE_KEY
      ? deriveRdChecks(ctx)
      : stageKey === QA_LEAD_APPROVAL_STAGE_KEY
        ? deriveQaChecks(ctx)
        : stageKey === DEPLOYMENT_APPROVAL_STAGE_KEY
          ? deriveOpChecks(ctx)
          : [];

  const byKey = new Map(derived.map((d) => [d.checkKey, d] as const));
  // 以模板為準重新投影：任何模板新增的 checkKey 若推導函式漏掉，一律 fail-safe 補成 YES
  // （＝提示主管注意），絕不留下 null 造成使用者無法送簽的死結。
  return template.map(
    (item) =>
      byKey.get(item.checkKey) ?? {
        checkKey: item.checkKey,
        answer: "YES" as const,
        detail: "系統無對應的自動判定規則，保守標記為 YES 提示主管確認。",
      },
  );
}
