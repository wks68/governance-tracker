"use server";

// M1.5-C1-C 新增：Team／TeamMember／Team LEAD 管理 Server Action。
//
// 新增／移除 MEMBER 呼叫 peopleService（teamMembershipService）；LEAD 指派／移除沿用
// 既有 teamLeadService（不重新實作 membershipRole 切換規則）。一律只做 FormData 解析
// → 呼叫服務層 → revalidate，規則檢查全部留在服務層。

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { addTeamMember, removeTeamMember } from "@/lib/peopleService";
import { assignTeamLead, removeTeamLead } from "@/lib/teamLeadService";
import { createTeam, updateTeam, deleteTeamIfUnreferenced } from "@/lib/team-applicant/teamManagementService";
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
// 「啟用／停用」在目前資料模型下無法表示，見 teamManagementService.ts 檔頭說明，本輪不提供。

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
