// Hotfix 九階段 UI 收斂新增：單一 UI mapping 模組，將既有 20 個 WorkflowStage stageKey
// （見 scripts/lib/buildHotfixWorkflowV1.ts）映射成使用者核准的 9 個正式業務階段。
//
// 這是全 Hotfix 新版 UI 唯一允許做「stageKey → 業務階段」判斷的地方；個別頁面一律呼叫
// 本檔案的函式，不得自行重複判斷邏輯。workflowStatus 純快取，本模組完全不讀取它——
// 一律以 WorkflowStage.stageKey（Issue.currentWorkflowStageId 解析出的實際關卡）為準。
//
// 對應規則（8 主管簽核關卡 + cancelled 屬性見下）：
//   1 Hotfix建立工單        draft
//   2 申請人直屬主管簽核     pendingBusinessApproval
//   3 RD修正與自測          pendingRdTriage / pendingRdClaim / rdInProgress
//   4 RD主管簽核            pendingRdLeadApproval
//   5 QA驗證                pendingQaTriage / pendingQaClaim / qaInProgress
//   6 QA主管簽核            pendingQaLeadApproval
//   7 OP上版                pendingOpTriage / pendingOpClaim / opPreparing
//   8 OP主管簽核            pendingDeploymentApproval / opDeploying / opCompleted
//   9 結案                  pendingReporterConfirmation / reporterConfirming / closed
//
// opDeploying／opCompleted 刻意併入第 8 階段（不是第 7 階段）：核准通過後的部署執行／
// 結果記錄，性質上緊接在 OP 主管核准之後、結案之前，若併入第 7 階段會讓進度列的「目前
// 階段索引」在核准通過後倒退（8→7），破壞「completed=打勾／current=實心藍點」的單調
// 前進語意；併入第 8 階段可維持索引單調遞增（7→8→8→8→9），且不需要新增第 10 個節點。
// cancelled 不屬於 9 個正式業務階段中任何一個，回傳 null，UI 端須另行顯示「已取消」。

export interface NineStageDef {
  index: number; // 1-9
  key: string;
  label: string;
}

export const NINE_STAGES: readonly NineStageDef[] = [
  { index: 1, key: "CREATE", label: "Hotfix建立工單" },
  { index: 2, key: "REQUESTER_APPROVAL", label: "申請人直屬主管簽核" },
  { index: 3, key: "RD_FIX", label: "RD修正與自測" },
  { index: 4, key: "RD_APPROVAL", label: "RD主管簽核" },
  { index: 5, key: "QA_VERIFY", label: "QA驗證" },
  { index: 6, key: "QA_APPROVAL", label: "QA主管簽核" },
  { index: 7, key: "OP_DEPLOY", label: "OP上版" },
  { index: 8, key: "OP_APPROVAL", label: "OP主管簽核" },
  { index: 9, key: "CLOSURE", label: "結案" },
];

const STAGE_KEY_TO_NINE_STAGE_INDEX: Record<string, number> = {
  draft: 1,
  pendingBusinessApproval: 2,
  pendingRdTriage: 3,
  pendingRdClaim: 3,
  rdInProgress: 3,
  pendingRdLeadApproval: 4,
  pendingQaTriage: 5,
  pendingQaClaim: 5,
  qaInProgress: 5,
  pendingQaLeadApproval: 6,
  pendingOpTriage: 7,
  pendingOpClaim: 7,
  opPreparing: 7,
  pendingDeploymentApproval: 8,
  opDeploying: 8,
  opCompleted: 8,
  pendingReporterConfirmation: 9,
  reporterConfirming: 9,
  closed: 9,
};

// cancelled 是唯一不對應任何九階段的關卡（終態，非正式流程的一部分）。
export function isCancelledStageKey(stageKey: string): boolean {
  return stageKey === "cancelled";
}

export function nineStageIndexOfStageKey(stageKey: string): number | null {
  return STAGE_KEY_TO_NINE_STAGE_INDEX[stageKey] ?? null;
}

export function nineStageLabelOfIndex(index: number): string {
  return NINE_STAGES.find((s) => s.index === index)?.label ?? `第 ${index} 階段`;
}

export function nineStageKeyOfIndex(index: number): string | null {
  return NINE_STAGES.find((s) => s.index === index)?.key ?? null;
}

// ---------------------------------------------------------------------------
// 路由：9 個獨立頁面（4 個唯讀主管簽核頁 + 5 個執行/結案頁）的路徑產生器，全站唯一
// 允許組出這些路徑字串的地方，避免各處各自硬編碼、日後改路徑要到處找。
// ---------------------------------------------------------------------------

export type HotfixRouteName = "create" | "approvalRequester" | "rd" | "approvalRd" | "qa" | "approvalQa" | "op" | "approvalOp" | "close";

const ROUTE_SUFFIX: Record<HotfixRouteName, string> = {
  create: "hotfix/create",
  approvalRequester: "hotfix/approval/requester",
  rd: "hotfix/rd",
  approvalRd: "hotfix/approval/rd",
  qa: "hotfix/qa",
  approvalQa: "hotfix/approval/qa",
  op: "hotfix/op",
  approvalOp: "hotfix/approval/op",
  close: "hotfix/close",
};

export function hotfixRoute(issueId: string, name: HotfixRouteName): string {
  return `/issues/${issueId}/${ROUTE_SUFFIX[name]}`;
}

// 依目前 stageKey 判斷「現在應該導向哪一個 Hotfix 九階段頁面」，供 Issue 明細頁做轉址、
// 也供各頁面在偵測到 Issue 已離開自己負責的關卡時（例如已被他人核准／退回）自我轉址。
// 回傳 null 表示目前關卡不在 9 階段任何一頁的管轄範圍內（例如 cancelled）——呼叫端此時
// 應該顯示終態畫面，不導向任何九階段頁面。
export function routeForStageKey(issueId: string, stageKey: string): string | null {
  switch (stageKey) {
    case "draft":
      return hotfixRoute(issueId, "create");
    case "pendingBusinessApproval":
      return hotfixRoute(issueId, "approvalRequester");
    case "pendingRdTriage":
    case "pendingRdClaim":
    case "rdInProgress":
      return hotfixRoute(issueId, "rd");
    case "pendingRdLeadApproval":
      return hotfixRoute(issueId, "approvalRd");
    case "pendingQaTriage":
    case "pendingQaClaim":
    case "qaInProgress":
      return hotfixRoute(issueId, "qa");
    case "pendingQaLeadApproval":
      return hotfixRoute(issueId, "approvalQa");
    case "pendingOpTriage":
    case "pendingOpClaim":
    case "opPreparing":
    case "opDeploying":
    case "opCompleted":
      return hotfixRoute(issueId, "op");
    case "pendingDeploymentApproval":
      return hotfixRoute(issueId, "approvalOp");
    case "pendingReporterConfirmation":
    case "reporterConfirming":
    case "closed":
      return hotfixRoute(issueId, "close");
    default:
      return null;
  }
}
