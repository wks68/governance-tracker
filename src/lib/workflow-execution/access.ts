// M2-B 新增：Issue Workflow 執行引擎的 actor 資格判斷。
//
// 只做「這個 actor 現在能不能對這個 Issue 目前所在的關卡做事」——與 M2-A 的
// src/lib/workflow/access.ts（誰能編輯流程「定義」）是完全不同的兩層，互不影響。
// 一律在呼叫端提供的 tx 內現場重新查詢，不接受呼叫端傳入的角色／成員身分快照。

import type { Prisma, PrismaClient, WorkflowStage } from "@prisma/client";
import { getUserHasCapability, type Capability } from "../permissions";
import { isTeamMembershipRole } from "../constants";
import { prisma } from "../prisma";
import { WorkflowExecutionAccessDeniedError } from "./types";

type Client = PrismaClient | Prisma.TransactionClient;

// tx-safe 版本的「這個人在這個 Team 目前的成員身分」查詢（src/lib/permissions.ts 的
// getTeamMembershipRole 硬綁全域 prisma，寫入服務在自己的 transaction 內解析時必須改用
// 本函式，避免另開一條連線在 SQLite 上跟持有寫鎖的 transaction 互相干擾）。
async function getTeamMembershipRoleInTx(client: Client, teamId: string, userId: string): Promise<"MEMBER" | "LEAD" | null> {
  const membership = await client.teamMember.findFirst({ where: { teamId, userId, isActive: true } });
  if (!membership || !isTeamMembershipRole(membership.membershipRole)) return null;
  return membership.membershipRole;
}

export interface ActorEligibilityResult {
  eligible: boolean;
  reasons: string[];
}

// 判斷 actorId 是否具備在 issue 目前這個 stage 執行動作的資格：
// 1. 基本能力 "issue.edit"（帳號需啟用中、具備此能力）——執行 Issue 流程動作的最低門檻。
// 2. stage.requiredExecutionRole：若設定，actor 必須擁有該 active UserRole（角色比對，
//    不是 Capability 比對——沿用 WorkflowStage 既有欄位語意，值為 RoleKey 字串）。
// 3. stage.requiredMembershipRole：若設定，actor 必須是 Issue.assignedTeamId 這個 Team
//    的啟用中成員；MEMBER 要求 MEMBER 或 LEAD 皆可，LEAD 要求恰好 LEAD。
//    Issue 尚未指派團隊（assignedTeamId=null）時一律視為不合格。
export async function evaluateActorEligibilityForStage(
  client: Client,
  actorId: string,
  issue: { assignedTeamId: string | null },
  stage: Pick<WorkflowStage, "requiredExecutionRole" | "requiredMembershipRole" | "stageKey">,
): Promise<ActorEligibilityResult> {
  const reasons: string[] = [];

  const user = await client.user.findUnique({ where: { id: actorId } });
  if (!user || !user.isActive) {
    return { eligible: false, reasons: ["帳號不存在或已停用"] };
  }

  const hasBaseline = await getUserHasCapability(user, "issue.edit", client);
  if (!hasBaseline) reasons.push('缺少基本能力 "issue.edit"');

  if (stage.requiredExecutionRole) {
    const activeRoles = await client.userRole.findMany({ where: { userId: actorId, isActive: true } });
    const roleKeys = new Set(activeRoles.map((r) => r.role));
    if (!roleKeys.has(stage.requiredExecutionRole)) {
      reasons.push(`此關卡要求角色「${stage.requiredExecutionRole}」`);
    }
  }

  if (stage.requiredMembershipRole) {
    if (!issue.assignedTeamId) {
      reasons.push("此關卡要求 Team 成員身分，但 Issue 尚未指派處理團隊");
    } else {
      const membershipRole = await getTeamMembershipRoleInTx(client, issue.assignedTeamId, actorId);
      const ok = stage.requiredMembershipRole === "LEAD" ? membershipRole === "LEAD" : membershipRole !== null;
      if (!ok) {
        reasons.push(`此關卡要求為處理團隊的 ${stage.requiredMembershipRole === "LEAD" ? "LEAD" : "成員"}`);
      }
    }
  }

  return { eligible: reasons.length === 0, reasons };
}

export async function requireActorEligibleForStage(
  client: Client,
  actorId: string,
  issue: { assignedTeamId: string | null },
  stage: Pick<WorkflowStage, "requiredExecutionRole" | "requiredMembershipRole" | "stageKey">,
): Promise<void> {
  const result = await evaluateActorEligibilityForStage(client, actorId, issue, stage);
  if (!result.eligible) {
    throw new WorkflowExecutionAccessDeniedError(`不具備在關卡「${stage.stageKey}」執行動作的資格：${result.reasons.join("; ")}`);
  }
}

export async function requireExecutionCapability(actorId: string, capability: Capability, client: Client = prisma): Promise<void> {
  const user = await client.user.findUnique({ where: { id: actorId } });
  if (!user || !user.isActive) throw new WorkflowExecutionAccessDeniedError("帳號不存在或已停用");
  const allowed = await getUserHasCapability(user, capability, client);
  if (!allowed) throw new WorkflowExecutionAccessDeniedError(`僅具備 "${capability}" 能力者可執行此操作`);
}

export async function hasExecutionCapability(actorId: string, capability: Capability, client: Client = prisma): Promise<boolean> {
  const user = await client.user.findUnique({ where: { id: actorId } });
  if (!user || !user.isActive) return false;
  return getUserHasCapability(user, capability, client);
}
