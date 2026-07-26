// M2-A 新增：Workflow 領域穩定 Facade。
//
// 呼叫端（Server Action／M2-A3 UI／verify scripts）一律從本檔案 import，不直接深入
// import src/lib/workflow/* 內部模組——內部模組責任拆分（types／validation／access／
// definitionService／versionService／stageService／transitionService／publishService／
// queries／compatibility）僅供本目錄內部組織與人類維護者理解，不對外形成穩定介面。
//
// 本檔案只負責匯出正式公開 API，不堆放實作細節。比照 src/lib/peopleService.ts 既有慣例。
//
// 注意：既有 M1 legacy 檔案 src/lib/workflow.ts（WORKFLOW_STEPS／statusLabel／isClosed）
// 與本目錄 src/lib/workflow/ 同名。TypeScript 模組解析在 "./workflow.ts" 與
// "./workflow/index.ts" 同時存在時，會優先解析到檔案（workflow.ts），永遠無法解析到本目錄，
// 因此下方必須明確寫成 "./workflow/index"（而非 "./workflow"），否則會靜默解析錯模組。
export * from "./workflow/index";
