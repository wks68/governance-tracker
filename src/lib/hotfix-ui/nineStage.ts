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
//   7 OP上版作業            pendingOpTriage / pendingOpClaim / opPreparing /
//                           pendingDeploymentApproval / opDeploying
//   8 OP主管上版後確認       opCompleted
//   9 結案                  pendingReporterConfirmation / reporterConfirming / closed
//
// 上版前核准是第 7 關的子步驟；正式部署紀錄送出後才進入第 8 關的獨立上版後主管確認。
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
  { index: 7, key: "OP_DEPLOY", label: "OP上版作業" },
  { index: 8, key: "OP_APPROVAL", label: "OP主管上版後確認" },
  { index: 9, key: "CLOSURE", label: "原申請人確認結案" },
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
  pendingDeploymentApproval: 7,
  opDeploying: 7,
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
// 舊制 Hotfix 唯讀顯示轉接
//
// 只把 Issue.workflowStatus 轉成九階段「顯示位置」，不建立 runtime、不寫回 Issue，也不
// 代表舊制資料曾實際執行新版 Workflow 的關卡或取得任何操作權。未知值仍顯示完整九階段，
// 但沒有 current 節點，呼叫端須清楚標示「舊制資料，僅供查閱」。
// ---------------------------------------------------------------------------

const LEGACY_WORKFLOW_STATUS_TO_NINE_STAGE_INDEX: Record<string, number> = {
  opened: 1,
  rdFix: 3,
  rdSelfTest: 3,
  qaVerify: 5,
  qaRelease: 6,
  opDeploy: 7,
  prodConfirm: 8,
};

export interface LegacyHotfixNineStageDisplay {
  currentIndex: number | null;
  cancelledAtIndex: number | null;
  terminalComplete: boolean;
  cancelled: boolean;
  statusKnown: boolean;
  stageLabel: string;
}

export function legacyHotfixNineStageDisplay(workflowStatus: string): LegacyHotfixNineStageDisplay {
  if (workflowStatus === "cancelled") {
    return {
      currentIndex: null,
      cancelledAtIndex: null,
      terminalComplete: false,
      cancelled: true,
      statusKnown: true,
      stageLabel: "已取消",
    };
  }

  const currentIndex = nineStageIndexOfStageKey(workflowStatus) ?? LEGACY_WORKFLOW_STATUS_TO_NINE_STAGE_INDEX[workflowStatus] ?? null;
  const terminalComplete = workflowStatus === "closed";
  return {
    currentIndex,
    cancelledAtIndex: null,
    terminalComplete,
    cancelled: false,
    statusKnown: currentIndex !== null,
    stageLabel: currentIndex === null ? "舊制狀態無法精確判斷" : nineStageLabelOfIndex(currentIndex),
  };
}

// ---------------------------------------------------------------------------
// 路由：9 個正式階段頁面（4 個唯讀主管簽核頁 + 5 個執行/結案頁），另加一個只服務
// 無正式 runtime 舊制 Hotfix 的唯讀 summary。這是全站唯一允許組出 Hotfix 詳情路徑的地方。
// ---------------------------------------------------------------------------

export type HotfixRouteName = "summary" | "create" | "approvalRequester" | "rd" | "approvalRd" | "qa" | "approvalQa" | "op" | "approvalOp" | "close";

const ROUTE_SUFFIX: Record<HotfixRouteName, string> = {
  summary: "hotfix/summary",
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
// cancelled 雖不屬於 9 個正式業務階段，仍由 close 頁提供專屬唯讀終態，避免退回舊通用頁。
// 回傳 null 只表示未知 stageKey，呼叫端不得自行發明第二套 stage mapping。
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
    case "cancelled":
      return hotfixRoute(issueId, "close");
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// 頁面副標題：一律由「目前 Workflow 關卡」決定，不得由 route 或頁面各自硬編碼。
//
// 缺陷修正背景：工單送出後已進入第 2 關，但頁面副標題仍停留在第 1 關的建立說明。
// 根因是副標題原本由每個頁面各自寫死字串，與實際 Workflow 狀態無關；改由本函式統一
// 依 stageKey 推導後，副標題不可能再與流程狀態不一致。
// ---------------------------------------------------------------------------

const STAGE_KEY_TO_SUBTITLE: Record<string, string> = {
  draft: "工單尚未送出，可繼續編輯內容後送交申請人直屬主管簽核。",
  pendingBusinessApproval: "工單已建立完成，等待申請人直屬主管核准中。",
  pendingRdTriage: "已完成主管簽核，等待 RD 團隊接單。",
  pendingRdClaim: "RD 團隊已接單，等待主管指派執行人。",
  rdInProgress: "RD 執行人修正與自測中。",
  pendingRdLeadApproval: "等待 RD 主管簽核中。",
  pendingQaTriage: "已完成 RD 主管簽核，等待 QA 團隊接單。",
  pendingQaClaim: "QA 團隊已接單，等待主管指派執行人。",
  qaInProgress: "QA 執行人驗證中。",
  pendingQaLeadApproval: "等待 QA 主管簽核中。",
  pendingOpTriage: "已完成 QA 主管簽核，等待 OP 團隊接單。",
  pendingOpClaim: "OP 團隊已接單，等待主管指派執行人。",
  opPreparing: "OP 團隊處理中，請完成上版前確認。",
  pendingDeploymentApproval: "上版計畫已提交，等待維運主管核准。",
  opDeploying: "上版前核准已完成，等待正式環境部署。",
  opCompleted: "正式環境部署已完成，等待維運主管確認。",
  pendingReporterConfirmation: "正式環境部署已確認，等待申請人確認結案。",
  reporterConfirming: "原申請人確認結案中。",
  closed: "此工單已結案。",
  cancelled: "此工單已取消，不再走正式九階段流程。",
};

/** 回傳 null 表示此 stageKey 沒有對應說明，呼叫端可退回頁面自帶的副標題。 */
export function hotfixStageSubtitle(stageKey: string): string | null {
  return STAGE_KEY_TO_SUBTITLE[stageKey] ?? null;
}
