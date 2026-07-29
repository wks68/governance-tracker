"use server";

// M1.5-C1-C 新增：Team／TeamMember／Team LEAD 管理 Server Action。
//
// 新增／移除 MEMBER 呼叫 peopleService（teamMembershipService）；LEAD 指派／移除沿用
// 既有 teamLeadService（不重新實作 membershipRole 切換規則）。一律只做 FormData 解析
// → 呼叫服務層 → revalidate，規則檢查全部留在服務層。

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import {
  addTeamMember,
  removeTeamMember,
  createTeamMember,
  setTeamMemberSupervisor,
  permanentlyDeleteMember,
  updatePersonProfile,
  updatePrimaryRole,
  assignSystemRole,
  activatePerson,
  deactivatePerson,
} from "@/lib/peopleService";
import { assignTeamLead, removeTeamLead } from "@/lib/teamLeadService";
import { createTeam, updateTeam, deleteTeamIfUnreferenced, setTeamActiveState } from "@/lib/team-applicant/teamManagementService";
import { isRoleKey, type RoleKey } from "@/lib/constants";
import { actionOk, toActionResult, type ActionResult } from "@/lib/actionResult";

function revalidateTeamPaths(teamId?: string) {
  revalidatePath("/admin/teams");
  if (teamId) revalidatePath(`/admin/teams/${teamId}`);
}

export async function addTeamMemberAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const teamId = String(formData.get("teamId") || "");
  const userId = String(formData.get("userId") || "");
  const reasonCode = String(formData.get("reasonCode") || "");
  try {
    await addTeamMember({ teamId, userId, actorId: actor.id, reasonCode });
    revalidateTeamPaths(teamId);
    return actionOk("已新增成員");
  } catch (err) {
    return toActionResult(err, "新增成員失敗");
  }
}

export async function removeTeamMemberAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const teamId = String(formData.get("teamId") || "");
  const userId = String(formData.get("userId") || "");
  const reasonCode = String(formData.get("reasonCode") || "");
  try {
    await removeTeamMember({ teamId, userId, actorId: actor.id, reasonCode });
    revalidateTeamPaths(teamId);
    return actionOk("已移除成員");
  } catch (err) {
    return toActionResult(err, "移除成員失敗");
  }
}

export async function assignTeamLeadAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const teamId = String(formData.get("teamId") || "");
  const userId = String(formData.get("userId") || "");
  const reasonCode = String(formData.get("reasonCode") || "");
  try {
    await assignTeamLead({ teamId, userId, actorId: actor.id, reasonCode });
    revalidateTeamPaths(teamId);
    return actionOk("已設為 LEAD");
  } catch (err) {
    return toActionResult(err, "設定 LEAD 失敗");
  }
}

export async function removeTeamLeadAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const teamId = String(formData.get("teamId") || "");
  const userId = String(formData.get("userId") || "");
  const reasonCode = String(formData.get("reasonCode") || "");
  try {
    await removeTeamLead({ teamId, userId, actorId: actor.id, reasonCode });
    revalidateTeamPaths(teamId);
    return actionOk("已移除 LEAD 資格");
  } catch (err) {
    return toActionResult(err, "移除 LEAD 失敗");
  }
}

// 建立工單／團隊整合修正新增：團隊 CRUD（建立／編輯名稱說明／無引用時永久刪除）。
// 成員管理權限收斂更新：Team.isActive 已新增，啟用／停用改由 setTeamActiveStateAction 提供。

export async function createTeamAction(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const actor = await requireCurrentUser();
  const name = String(formData.get("name") || "");
  const description = String(formData.get("description") || "");
  try {
    const team = await createTeam({ name, description, actorId: actor.id });
    revalidateTeamPaths();
    return actionOk("已建立團隊", { id: team.id });
  } catch (err) {
    return toActionResult(err, "建立團隊失敗");
  }
}

export async function updateTeamAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const teamId = String(formData.get("teamId") || "");
  const name = String(formData.get("name") || "");
  const description = String(formData.get("description") || "");
  try {
    await updateTeam({ teamId, name, description, actorId: actor.id });
    revalidateTeamPaths(teamId);
    return actionOk("已更新團隊");
  } catch (err) {
    return toActionResult(err, "更新團隊失敗");
  }
}

export async function deleteTeamAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const teamId = String(formData.get("teamId") || "");
  try {
    await deleteTeamIfUnreferenced({ teamId, actorId: actor.id });
  } catch (err) {
    return toActionResult(err, "刪除團隊失敗");
  }
  revalidateTeamPaths();
  redirect("/admin/teams");
}

// ---------------------------------------------------------------------------
// 成員管理權限收斂新增：最高權限管理員／團隊主管共用的成員管理 Server Action。
//
// 每一個 action 都把「操作範圍所在團隊」(teamId／teamScopeId) 一併交給服務層，由服務層
// 以 actorId 現場重新解析授權（Admin 能力 或 該團隊 active LEAD）。這裡不做任何權限判斷，
// 也不因為前端沒有顯示按鈕就假設呼叫端有權限——偽造 teamId 的請求會在服務層被拒絕。
// ---------------------------------------------------------------------------

function parseRole(formData: FormData, field = "role"): RoleKey {
  const raw = String(formData.get(field) || "");
  if (!isRoleKey(raw)) throw new Error(`角色不在合法值域：${raw}`);
  return raw;
}

export async function createTeamMemberAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const teamId = String(formData.get("teamId") || "");
  const supervisorUserId = String(formData.get("supervisorUserId") || "");
  const loginIdentifier = String(formData.get("loginIdentifier") || "");
  try {
    await createTeamMember({
      teamId,
      name: String(formData.get("name") || ""),
      email: String(formData.get("email") || ""),
      loginIdentifier: loginIdentifier || null,
      department: String(formData.get("department") || ""),
      role: parseRole(formData),
      supervisorUserId: supervisorUserId || null,
      isActive: String(formData.get("isActive") || "true") === "true",
      actorId: actor.id,
      reasonCode: String(formData.get("reasonCode") || ""),
    });
    revalidateTeamPaths(teamId);
    return actionOk("已新增成員");
  } catch (err) {
    return toActionResult(err, "新增成員失敗");
  }
}

export async function updateTeamMemberProfileAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const teamId = String(formData.get("teamId") || "");
  const loginIdentifier = String(formData.get("loginIdentifier") || "");
  try {
    await updatePersonProfile({
      userId: String(formData.get("userId") || ""),
      name: String(formData.get("name") || ""),
      department: String(formData.get("department") || ""),
      loginIdentifier: loginIdentifier || null,
      actorId: actor.id,
      reasonCode: String(formData.get("reasonCode") || ""),
      teamScopeId: teamId,
    });
    revalidateTeamPaths(teamId);
    return actionOk("已更新成員基本資料");
  } catch (err) {
    return toActionResult(err, "更新成員基本資料失敗");
  }
}

export async function changeTeamMemberRoleAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const teamId = String(formData.get("teamId") || "");
  const userId = String(formData.get("userId") || "");
  const reasonCode = String(formData.get("reasonCode") || "");
  try {
    const role = parseRole(formData);
    // 先確保該角色是 active UserRole（已存在時服務層會回報，視為已具備），再設為主要角色。
    try {
      await assignSystemRole({ userId, role, actorId: actor.id, reasonCode, teamScopeId: teamId });
    } catch (err) {
      // 已經具有該 active 角色時不算失敗，繼續設為主要角色。
      if (!(err instanceof Error) || !err.message.includes("已經具有 active 角色")) throw err;
    }
    await updatePrimaryRole({ userId, role, actorId: actor.id, reasonCode, teamScopeId: teamId });
    revalidateTeamPaths(teamId);
    return actionOk("已更新成員角色");
  } catch (err) {
    return toActionResult(err, "更新成員角色失敗");
  }
}

export async function setTeamMemberSupervisorAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const teamId = String(formData.get("teamId") || "");
  try {
    await setTeamMemberSupervisor({
      teamId,
      userId: String(formData.get("userId") || ""),
      supervisorUserId: String(formData.get("supervisorUserId") || ""),
      actorId: actor.id,
      reasonCode: String(formData.get("reasonCode") || ""),
    });
    revalidateTeamPaths(teamId);
    return actionOk("已設定直屬主管");
  } catch (err) {
    return toActionResult(err, "設定直屬主管失敗");
  }
}

export async function setTeamMemberActiveAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const teamId = String(formData.get("teamId") || "");
  const userId = String(formData.get("userId") || "");
  const reasonCode = String(formData.get("reasonCode") || "");
  const nextActive = String(formData.get("isActive") || "") === "true";
  try {
    if (nextActive) {
      await activatePerson({ userId, actorId: actor.id, reasonCode, teamScopeId: teamId });
    } else {
      await deactivatePerson({ userId, actorId: actor.id, reasonCode, teamScopeId: teamId });
    }
    revalidateTeamPaths(teamId);
    return actionOk(nextActive ? "已啟用成員" : "已停用成員");
  } catch (err) {
    return toActionResult(err, nextActive ? "啟用成員失敗" : "停用成員失敗");
  }
}

export async function permanentlyDeleteMemberAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const teamId = String(formData.get("teamId") || "");
  try {
    await permanentlyDeleteMember({
      teamId,
      userId: String(formData.get("userId") || ""),
      actorId: actor.id,
      reasonCode: String(formData.get("reasonCode") || ""),
    });
    revalidateTeamPaths(teamId);
    return actionOk("已永久刪除成員");
  } catch (err) {
    return toActionResult(err, "永久刪除成員失敗");
  }
}

export async function setTeamActiveStateAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const teamId = String(formData.get("teamId") || "");
  const isActive = String(formData.get("isActive") || "") === "true";
  try {
    await setTeamActiveState({ teamId, isActive, actorId: actor.id, reasonCode: String(formData.get("reasonCode") || "") });
    revalidateTeamPaths(teamId);
    return actionOk(isActive ? "已啟用團隊" : "已停用團隊");
  } catch (err) {
    return toActionResult(err, isActive ? "啟用團隊失敗" : "停用團隊失敗");
  }
}
