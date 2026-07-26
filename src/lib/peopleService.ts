// C1-B3 新增：People 領域穩定 Facade。
//
// 呼叫端（Server Action／未來 C1-C UI／verify scripts）一律從本檔案 import，不直接深入
// import src/lib/people/* 內部模組——內部模組responsibilities 拆分（types／validation／
// access／queries／profileService／roleService／teamMembershipService／
// deactivationService）僅供本目錄內部組織與人類維護者理解，不對外形成穩定介面。
//
// 本檔案只負責匯出正式公開 API，不堆放實作細節。

export * from "./people";
