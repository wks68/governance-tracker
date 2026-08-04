// 工單編號持久化計數器模組——穩定 facade。
//
// 刻意獨立成一個小模組，不堆進 src/lib/issueCreation.ts：本模組不認識 Workflow／Auth／
// Approval 等任何其他領域概念，只認識「issueType -> 下一個編號」這一件事，方便未來
// 若有其他呼叫端（例如批次匯入、其他工單類型的建立流程）需要相同保證時直接重用，
// 不需要連帶引入建立工單的其餘驗證邏輯。

export {
  allocateNextIssueKey,
  isTransientTransactionConflict,
  InvalidIssueTypeError,
  IssueKeySequenceNotConfiguredError,
} from "./allocationService";

export {
  synchronizeIssueKeySequencesFromExistingIssues,
  synchronizeIssueKeySequenceForType,
  KNOWN_HISTORICAL_FLOORS,
} from "./synchronizationService";
