// 治理儀表板 MVP 新增：可見性與授權判斷。
//
// 現況說明：目前整個程式庫（/issues、/dashboard 既有頁面）對 Issue 只有「能不能看」
// 這一層 Capability 判斷（issue.view，全域授予 PM／RD／QA／OP／資安推動小組／DMS主管／
// Admin），完全沒有既有的「Issue row-level 依 Team 或案件擁有者縮限可見範圍」規則可供
// 沿用——這與 People／Team 領域（listPeopleForActor／listTeamsForActor 有 Team LEAD
// 範圍縮限）不同。治理儀表板沿用 Issue 領域現有唯一的可見性規則：具備 issue.view 能力
// 者可見全部 Issue（含 Admin），不具備者一律拒絕，不提供部分可見的中間狀態。
//
// 一律在服務層以 actorId 現場重新查詢 active UserRole（getUserHasCapability 只讀
// active UserRole，不讀 User.role），不接受呼叫端傳入的角色／可見範圍旗標。

import type { Prisma, PrismaClient } from "@prisma/client";
import { getUserHasCapability } from "../permissions";
import { prisma } from "../prisma";
import { GovernanceDashboardAccessDeniedError } from "./types";

type Client = PrismaClient | Prisma.TransactionClient;

export interface GovernanceDashboardAccessContext {
  canView: boolean;
}

export async function resolveGovernanceDashboardAccess(
  actorId: string,
  client: Client = prisma,
): Promise<GovernanceDashboardAccessContext> {
  const canView = await getUserHasCapability({ id: actorId }, "issue.view", client);
  return { canView };
}

export async function requireGovernanceDashboardAccess(actorId: string, client: Client = prisma): Promise<void> {
  const { canView } = await resolveGovernanceDashboardAccess(actorId, client);
  if (!canView) throw new GovernanceDashboardAccessDeniedError();
}
