// M2-A 新增：Workflow 領域 Capability 檢查。
//
// 只包裝既有 src/lib/permissions.ts 的 requireCapability／getUserHasCapability，
// 不重建第二套權限判斷邏輯、不快取、不接受呼叫端傳入的旗標——一律以 actorId
// 現場（在呼叫端提供的 tx 內）重新解析。比照 src/lib/people/access.ts 既有慣例。

import type { Prisma, PrismaClient } from "@prisma/client";
import { requireCapability, getUserHasCapability, type Capability } from "../permissions";
import { prisma } from "../prisma";
import { WorkflowAccessDeniedError } from "./types";

type Client = PrismaClient | Prisma.TransactionClient;

export async function requireWorkflowCapability(actorId: string, capability: Capability, client: Client = prisma): Promise<void> {
  try {
    await requireCapability({ id: actorId }, capability, client);
  } catch {
    throw new WorkflowAccessDeniedError(`僅具備 "${capability}" 能力者可執行此操作`);
  }
}

export async function hasWorkflowCapability(actorId: string, capability: Capability, client: Client = prisma): Promise<boolean> {
  return getUserHasCapability({ id: actorId }, capability, client);
}
