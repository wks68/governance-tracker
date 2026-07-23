// Mock AI Assistant Service Layer
// 目前為規則式產生的模擬內容，尚未串接真正的 AI API。
// 未來若要串接真正的 AI（例如 Anthropic / OpenAI API），
// 只需替換本檔案中 generateAiSuggestion() 的實作，
// 呼叫端（Server Actions / UI）不需變動。

export type AiSuggestionType =
  | "ProblemSummary"
  | "ImpactScope"
  | "RcaDraft"
  | "CorrectiveAction"
  | "PreventiveAction"
  | "NextStep"
  | "EvidenceGap"
  | "RdSelfTestItems";

export const AI_SUGGESTION_LABELS: Record<AiSuggestionType, string> = {
  ProblemSummary: "產生問題描述整理",
  ImpactScope: "建議影響範圍",
  RcaDraft: "產生 RCA 草稿",
  CorrectiveAction: "建議矯正措施",
  PreventiveAction: "建議預防措施",
  NextStep: "建議下一步",
  EvidenceGap: "檢查缺漏佐證",
  RdSelfTestItems: "產生自測項目草稿",
};

export interface AiContext {
  issueKey: string;
  issueType: string;
  issueTypeLabel: string;
  title: string;
  description: string;
  systemName: string;
  environment: string;
  riskLevel: string;
  workflowStatus: string;
  missingFields: string[];
  missingEvidence: string[];
  evidenceCount: number;
}

export function buildAiPrompt(type: AiSuggestionType, ctx: AiContext): string {
  return `[Mock AI] 類型=${AI_SUGGESTION_LABELS[type]}；工單=${ctx.issueKey}；狀態=${ctx.workflowStatus}`;
}

export function generateAiSuggestion(type: AiSuggestionType, ctx: AiContext): string {
  const sys = ctx.systemName || "（未填寫系統名稱）";
  const env = ctx.environment || "（未填寫環境）";

  switch (type) {
    case "ProblemSummary":
      return [
        `【問題描述整理草稿】`,
        `工單 ${ctx.issueKey}（${ctx.issueTypeLabel}）涉及系統：${sys}，環境：${env}。`,
        `原始描述：${ctx.description || "（尚未填寫問題描述）"}`,
        `整理建議：請確認問題發生時間、觸發條件、可重現步驟，並補充是否為單一事件或持續發生。`,
        `建議將上述資訊整理為結構化描述，利於後續 RD / QA 判讀影響範圍。`,
      ].join("\n");

    case "ImpactScope":
      return [
        `【影響範圍建議草稿】`,
        `依工單標題「${ctx.title}」與系統 ${sys}（${env} 環境）研判，建議評估以下面向：`,
        `1. 是否影響正式環境對外服務。`,
        `2. 是否涉及使用者資料或交易資料。`,
        `3. 影響使用者範圍（全體 / 特定客群 / 內部人員）。`,
        `4. 是否有相依系統或下游服務受影響。`,
        `請 RD / OP 確認後填入正式影響範圍欄位。`,
      ].join("\n");

    case "RcaDraft":
      return [
        `【RCA 根因分析草稿】`,
        `事件摘要：${ctx.title}（系統：${sys}，環境：${env}）`,
        `初步根因假設：`,
        `1. 直接原因：請填入實際觸發問題的操作或程式變更。`,
        `2. 根本原因：請追溯至流程、設計或監控缺口層面的原因。`,
        `3. 偵測落差：說明為何未能提早發現此問題。`,
        `本草稿僅為結構參考，實際根因需由 RD / QA / 資安推動小組共同確認。`,
      ].join("\n");

    case "CorrectiveAction":
      return [
        `【矯正措施建議】`,
        `1. 針對本次問題進行程式碼修正或設定調整，並於 ${env} 環境完成驗證。`,
        `2. 補強單元測試 / 整合測試涵蓋此問題情境。`,
        `3. 通知相關系統負責人與 ${ctx.riskLevel || "（未評估）"} 風險等級對應的關卡人員。`,
        `請由 RD 確認具體矯正項目與完成時間。`,
      ].join("\n");

    case "PreventiveAction":
      return [
        `【預防措施建議】`,
        `1. 建議於 ${sys} 增設對應監控項目與告警規則，縮短偵測時間。`,
        `2. 建議將此類情境納入上線前檢查清單（Checklist）。`,
        `3. 建議定期複盤（例如每季）檢視類似風險是否重複發生。`,
        `請由資安推動小組 / DMS 主管確認是否納入治理常態檢核。`,
      ].join("\n");

    case "NextStep": {
      const missing = ctx.missingFields.length > 0 ? `尚缺欄位：${ctx.missingFields.join("、")}` : "必要欄位已齊備";
      const evidence = ctx.missingEvidence.length > 0 ? `尚缺佐證：${ctx.missingEvidence.join("、")}` : `目前已有 ${ctx.evidenceCount} 筆佐證資料`;
      return [
        `【下一步建議】`,
        `目前關卡：${ctx.workflowStatus}`,
        missing,
        evidence,
        `建議下一步：請權責角色確認上述缺漏項目後，再推進至下一個流程關卡。`,
      ].join("\n");
    }

    case "RdSelfTestItems":
      return [
        `【自測項目草稿】`,
        `工單 ${ctx.issueKey}「${ctx.title}」（系統：${sys}，環境：${env}）`,
        `建議自測項目：`,
        `1. 重現原始問題步驟，確認問題已不再發生。`,
        `2. 針對本次修正變更的功能／頁面進行正常情境測試。`,
        `3. 針對修正範圍相鄰的功能進行迴歸測試，確認未產生新問題。`,
        `4. 若涉及資料或設定調整，請確認資料正確性與既有資料不受影響。`,
        `請依實際修正內容調整上述項目，並附上測試截圖或紀錄連結作為佐證。`,
      ].join("\n");

    case "EvidenceGap": {
      if (ctx.missingEvidence.length === 0 && ctx.evidenceCount > 0) {
        return `【缺漏佐證提醒】目前已有 ${ctx.evidenceCount} 筆佐證資料，暫未偵測到明顯缺漏，惟仍建議由權責人員複核佐證品質與完整性。`;
      }
      return [
        `【缺漏佐證提醒】`,
        `目前佐證資料筆數：${ctx.evidenceCount}`,
        ctx.missingEvidence.length > 0 ? `缺漏項目：${ctx.missingEvidence.join("、")}` : `建議至少補充一筆佐證資料（例如 Log、監控截圖、Jira 連結或結案留言）`,
        `請於結案前補齊，以利稽核追溯。`,
      ].join("\n");
    }

    default:
      return "（無法產生建議內容）";
  }
}
