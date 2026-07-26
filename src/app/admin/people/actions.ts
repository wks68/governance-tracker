"use server";

// M1.5-C1-C 新增：人員管理 Server Action。
//
// 只做：取得 actor → 解析 FormData → 呼叫 peopleService → revalidate。所有規則
// （Capability、reasonCode 必填、停用 blocking、角色 blocking…）一律留在服務層，
// 這裡只把服務層拋出的領域錯誤轉成 ActionResult，不吞、不改寫錯誤語意。

import { revalidatePath } from "next/cache";
import { requireCurrentUser } from "@/lib/auth";
import {
  createPerson,
  updatePersonProfile,
  assignSystemRole,
  updatePrimaryRole,
  removeSystemRole,
  activatePerson,
  checkUserDeactivationImpact,
  deactivatePerson,
  type DeactivationImpactItem,
} from "@/lib/peopleService";
import { isRoleKey } from "@/lib/constants";
import { actionOk, toActionResult, type ActionResult } from "@/lib/actionResult";

function revalidatePeoplePaths(userId?: string) {
  revalidatePath("/admin/people");
  if (userId) revalidatePath(`/admin/people/${userId}`);
}

function readOptionalText(formData: FormData, key: string): string | undefined {
  const raw = formData.get(key);
  return raw === null ? undefined : String(raw);
}

export async function createPersonAction(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const actor = await requireCurrentUser();
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const department = String(formData.get("department") || "").trim();
  const loginIdentifier = String(formData.get("loginIdentifier") || "").trim();
  const initialRole = String(formData.get("initialRole") || "");
  const reasonCode = String(formData.get("reasonCode") || "");

  if (!isRoleKey(initialRole)) {
    return { ok: false, code: "INVALID_ROLE", message: "請選擇有效的初始角色", fieldErrors: { initialRole: "請選擇有效的初始角色" } };
  }

  try {
    const created = await createPerson({
      name,
      email,
      department,
      loginIdentifier: loginIdentifier || null,
      initialRole,
      actorId: actor.id,
      reasonCode,
    });
    revalidatePeoplePaths(created.id);
    return actionOk("已建立人員", { id: created.id });
  } catch (err) {
    return toActionResult(err, "建立人員失敗");
  }
}

export async function updatePersonProfileAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const userId = String(formData.get("userId") || "");
  const name = readOptionalText(formData, "name");
  const department = readOptionalText(formData, "department");
  const loginIdentifier = readOptionalText(formData, "loginIdentifier");
  const reasonCode = String(formData.get("reasonCode") || "");

  try {
    await updatePersonProfile({
      userId,
      name: name !== undefined ? name.trim() : undefined,
      department: department !== undefined ? department.trim() : undefined,
      loginIdentifier: loginIdentifier !== undefined ? loginIdentifier.trim() : undefined,
      actorId: actor.id,
      reasonCode,
    });
    revalidatePeoplePaths(userId);
    return actionOk("已更新基本資料");
  } catch (err) {
    return toActionResult(err, "更新基本資料失敗");
  }
}

export async function assignSystemRoleAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const userId = String(formData.get("userId") || "");
  const role = String(formData.get("role") || "");
  const reasonCode = String(formData.get("reasonCode") || "");

  if (!isRoleKey(role)) {
    return { ok: false, code: "INVALID_ROLE", message: "請選擇有效的角色" };
  }
  try {
    await assignSystemRole({ userId, role, actorId: actor.id, reasonCode });
    revalidatePeoplePaths(userId);
    return actionOk("已指派角色");
  } catch (err) {
    return toActionResult(err, "指派角色失敗");
  }
}

export async function updatePrimaryRoleAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const userId = String(formData.get("userId") || "");
  const role = String(formData.get("role") || "");
  const reasonCode = String(formData.get("reasonCode") || "");

  if (!isRoleKey(role)) {
    return { ok: false, code: "INVALID_ROLE", message: "請選擇有效的角色" };
  }
  try {
    await updatePrimaryRole({ userId, role, actorId: actor.id, reasonCode });
    revalidatePeoplePaths(userId);
    return actionOk("已切換主要角色");
  } catch (err) {
    return toActionResult(err, "切換主要角色失敗");
  }
}

export async function removeSystemRoleAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const userId = String(formData.get("userId") || "");
  const role = String(formData.get("role") || "");
  const reasonCode = String(formData.get("reasonCode") || "");

  if (!isRoleKey(role)) {
    return { ok: false, code: "INVALID_ROLE", message: "請選擇有效的角色" };
  }
  try {
    await removeSystemRole({ userId, role, actorId: actor.id, reasonCode });
    revalidatePeoplePaths(userId);
    return actionOk("已移除角色");
  } catch (err) {
    return toActionResult(err, "移除角色失敗");
  }
}

export async function activatePersonAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const userId = String(formData.get("userId") || "");
  const reasonCode = String(formData.get("reasonCode") || "");
  try {
    await activatePerson({ userId, actorId: actor.id, reasonCode });
    revalidatePeoplePaths(userId);
    return actionOk("已啟用人員");
  } catch (err) {
    return toActionResult(err, "啟用人員失敗");
  }
}

// 第一階段：明確按下「檢查停用影響」，寫入 UserDeactivationImpactChecked AuditLog。
export async function checkDeactivationImpactAction(formData: FormData): Promise<ActionResult<DeactivationImpactItem[]>> {
  const actor = await requireCurrentUser();
  const userId = String(formData.get("userId") || "");
  try {
    const impact = await checkUserDeactivationImpact({ userId, actorId: actor.id });
    return actionOk("已完成停用影響檢查", impact);
  } catch (err) {
    return toActionResult(err, "停用影響檢查失敗");
  }
}

// 第二階段：確認停用。Service 會在 transaction 內重新計算一次影響分析，blocking 存在時整筆拒絕。
export async function deactivatePersonAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const userId = String(formData.get("userId") || "");
  const reasonCode = String(formData.get("reasonCode") || "");
  try {
    await deactivatePerson({ userId, actorId: actor.id, reasonCode });
    revalidatePeoplePaths(userId);
    return actionOk("已停用人員");
  } catch (err) {
    return toActionResult(err, "停用人員失敗");
  }
}
