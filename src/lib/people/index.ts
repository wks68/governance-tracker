// C1-B3 新增：People 領域模組聚合匯出。
//
// src/lib/peopleService.ts（穩定 Facade）從本檔案匯出，外部呼叫端一律經由
// peopleService.ts 呼叫，不直接 import src/lib/people/* 內部檔案。

export * from "./types";

export { createPerson, updatePersonProfile, activatePerson } from "./profileService";
export { assignSystemRole, updatePrimaryRole, removeSystemRole } from "./roleService";
export { addTeamMember, removeTeamMember } from "./teamMembershipService";
export { getUserDeactivationImpact, checkUserDeactivationImpact, deactivatePerson } from "./deactivationService";
export { listPeopleForActor, getPersonDetailForActor, listTeamsForActor, getTeamDetailForActor } from "./queries";

// C1-C 新增：UI 需要「這位 actor 能不能做 X」的唯讀提示（僅供決定要不要顯示某個按鈕／
// 表單），實際授權仍一律由各服務在呼叫當下重新解析——UI 不得快取或傳遞此結果代替
// 服務層檢查。刻意只匯出 has*（唯讀查詢），不匯出 require*（會拋錯，不適合 UI 讀取路徑）。
export { hasPeopleCapability, resolveLedTeamIds, isActiveLeadOfTeam } from "./access";

// 成員管理權限收斂新增：最高權限管理員／團隊主管共用的成員管理服務層。
export {
  resolveMemberManagementScope,
  canActorManageTeamMembers,
  createTeamMember,
  setTeamMemberSupervisor,
  collectMemberDeletionBlockers,
  permanentlyDeleteMember,
} from "./memberDirectoryService";
export type { MemberManagementScope, CreateTeamMemberInput, SetTeamMemberSupervisorInput, MemberDeletionBlocker } from "./memberDirectoryService";
