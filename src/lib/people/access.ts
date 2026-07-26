// C1-B3 新增：People 領域 Capability 檢查。
//
// 只包裝既有 src/lib/permissions.ts 的 requireCapability／getUserHasCapability，
// 不重建第二套權限判斷邏輯、不快取、不接受呼叫端傳入的旗標——一律以 actorId
// 現場（在呼叫端提供的 tx 內）重新解析。

import type { Prisma, PrismaClient } from "@prisma/client";
import { requireCapability, getUserHasCapability, type Capability } from "../permissions";
import { prisma } from "../prisma";
import { PeopleAccessDeniedError } from "./types";

type Client = PrismaClient | Prisma.TransactionClient;

// deny-by-default：actorId 不具備指定 Capability（含 actor 本身 inactive／不存在）時拋出
// PeopleAccessDeniedError，統一 People 領域對外的存取拒絕錯誤型別。
export async function requirePeopleCapability(
  actorId: string,
  capability: Capability,
  client: Client = prisma,
): Promise<void> {
  try {
    await requireCapability({ id: actorId }, capability, client);
  } catch {
    throw new PeopleAccessDeniedError(`僅具備 "${capability}" 能力者可執行此操作`);
  }
}

export async function hasPeopleCapability(actorId: string, capability: Capability, client: Client = prisma): Promise<boolean> {
  return getUserHasCapability({ id: actorId }, capability, client);
}
