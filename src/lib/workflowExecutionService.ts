// M2-B 新增：Issue Workflow 執行引擎穩定 Facade。
//
// 呼叫端（Server Action／執行 UI／verify scripts／createIssueAction）一律從本檔案 import，
// 不直接深入 import src/lib/workflow-execution/* 內部模組——內部模組責任拆分（types／
// validation／access／startService／transitionService／requirementService／
// assignmentService／historyService／queries／compatibility）僅供本目錄內部組織與人類
// 維護者理解，不對外形成穩定介面。比照 src/lib/workflowService.ts（M2-A）既有慣例。
//
// 注意：本檔案位於 src/lib/ 下、模組目錄為 src/lib/workflow-execution/，兩者名稱不同
// （不像 workflow.ts 與 workflow/ 那樣同名），因此不會發生模組解析優先解到檔案而非目錄
// 的問題，可直接寫 "./workflow-execution"。
export * from "./workflow-execution";
