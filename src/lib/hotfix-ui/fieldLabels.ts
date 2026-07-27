// Hotfix 操作畫面收斂新增：WorkflowStageRequirement.targetKey → 人看得懂的欄位名稱。
//
// WorkflowStageRequirement 本身沒有 fieldLabel 欄位（見 prisma/schema.prisma，本輪不得
// 新增 Schema），「目前待完成事項」不得直接顯示 targetKey 這種技術鍵值，因此在 UI 層
// 建立這個小型對照表。找不到對應鍵值時 fallback 為該 targetKey 本身（至少不會顯示空白
// 或報錯），但不會是常見情況——目前 Hotfix v1 只用到 rdFixVersion／qaTestResult 兩個
// REQUIRE_FIELD 鍵值。

const FIELD_LABEL_BY_KEY: Record<string, string> = {
  rdFixVersion: "修正版本／Branch／Commit",
  qaTestResult: "QA 測試結果",
};

export function fieldLabelOf(targetKey: string): string {
  return FIELD_LABEL_BY_KEY[targetKey] ?? targetKey;
}

export function evidenceLabelOf(targetKey: string): string {
  if (targetKey === "ANY") return "佐證資料（不限類型）";
  return `「${targetKey}」類型的佐證資料`;
}
