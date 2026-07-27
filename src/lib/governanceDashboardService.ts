// 治理儀表板 MVP 新增：穩定 Facade。
//
// 呼叫端（Server Component／verify scripts）一律從本檔案 import，不直接深入
// src/lib/governance-dashboard/* 內部模組——內部模組拆分（types／filters／access／
// queries／metrics／viewModel）僅供本目錄內部組織與人類維護者理解，不對外形成穩定
// 介面。比照 src/lib/workflowExecutionService.ts（M2-B）既有慣例。
//
// 檔案位於 src/lib/ 下、模組目錄為 src/lib/governance-dashboard/，兩者名稱不同，
// 不會發生模組解析優先解到檔案而非目錄的問題，可直接寫 "./governance-dashboard"。
export * from "./governance-dashboard";
