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
