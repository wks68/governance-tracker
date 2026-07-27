// Hotfix 操作畫面收斂新增：WorkflowTransition.actionKey → 實際工作語意的按鈕文案。
//
// 正式畫面不得出現「推進至下一關卡」「返回上一關」「FORWARD」「RETURN」「CANCEL」等
// 技術用語（見需求三）。這裡只是「顯示文案」這一層——不改變 Engine 本身的 actionKey／
// label／transitionType，執行時仍是原本的 executeIssueTransition／returnIssueToStage／
// cancelIssueWorkflow，權限與規則一律由服務層現場重新驗證，這裡的文案只是給人看的。
//
// 對照表以 scripts/lib/buildHotfixWorkflowV1.ts 目前唯一在用的 Hotfix v1 actionKey 為準；
// 找不到對應 actionKey 時 fallback 為該 Transition 自己的 label（Engine 既有欄位，一樣是
// 中文顯示文字，不是技術值），確保未來新增 Transition 時畫面不會顯示為空或報錯。

export interface TransitionCopyEntry {
  label: string;
  // RETURN 動作務必清楚顯示退回目標（需求三第 4 點），這裡固定寫死退回目標的說法，
  // 實際目標關卡名稱由呼叫端另外組合（例如「退回 RD 修正（退回至：RD 修正中）」）。
  showsReturnTarget?: boolean;
}

const TRANSITION_COPY_BY_ACTION_KEY: Record<string, TransitionCopyEntry> = {
  // ---- 開單／業務核准 ----
  submit: { label: "提交送業務核准" },
  businessApprove: { label: "業務核准，交付 RD" },
  businessReject: { label: "退回修改申請內容", showsReturnTarget: true },

  // ---- RD ----
  rdAssign: { label: "指派 RD 處理團隊" },
  rdClaim: { label: "認領並開始修正" },
  rdSubmit: { label: "提交 RD 自測，送主管核准" },
  rdLeadApprove: { label: "核准並送交 QA 驗證" },
  rdLeadReject: { label: "退回 RD 修正", showsReturnTarget: true },

  // ---- QA ----
  qaAssign: { label: "指派 QA 處理團隊" },
  qaClaim: { label: "認領並開始驗證" },
  qaSubmit: { label: "提交 QA 驗證結果，送放行確認" },
  qaLeadApprove: { label: "QA 放行，送交 OP 上版" },
  qaLeadReject: { label: "退回 QA 驗證", showsReturnTarget: true },

  // ---- OP ----
  opAssign: { label: "指派 OP 處理團隊" },
  opClaim: { label: "認領並準備上版" },
  opSubmit: { label: "提交正式上版申請" },
  opLeadApprove: { label: "核准部署，開始上版" },
  opLeadReject: { label: "退回上版準備", showsReturnTarget: true },
  opDeployComplete: { label: "回報上版完成" },
  opRollbackStart: { label: "回滾，退回上版準備", showsReturnTarget: true },

  // ---- 正式環境確認 ----
  reporterConfirmOpen: { label: "開放開單人確認" },
  reporterClaim: { label: "開始正式環境確認" },
  reporterClose: { label: "確認完成並結案" },
  reporterRejectConfirm: { label: "發現異常，退回處理", showsReturnTarget: true },

  // ---- OP 分流裁決（退回上游）----
  opTriageNeedsRdFix: { label: "判定需 RD 修正，退回 RD", showsReturnTarget: true },
  opTriageNeedsQaRework: { label: "判定需 QA 重新驗證，退回 QA", showsReturnTarget: true },

  // ---- 取消 ----
  cancelDraft: { label: "取消 Hotfix" },
  cancelPendingBusinessApproval: { label: "取消 Hotfix" },
};

export function transitionCopyOf(actionKey: string, fallbackLabel: string): TransitionCopyEntry {
  return TRANSITION_COPY_BY_ACTION_KEY[actionKey] ?? { label: fallbackLabel };
}
