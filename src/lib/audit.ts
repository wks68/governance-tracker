import { prisma } from "./prisma";

export type ActionType =
  | "IssueCreated"
  | "StatusChange"
  | "FieldChange"
  | "CommentAdded"
  | "EvidenceAdded"
  | "AiSuggestion"
  | "RoleChange"
  | "AccountStatusChange"
  | "TeamReassigned"; // M1 新增：供 M3 起團隊指派/轉派事件使用

export type EntityType = "Issue" | "User";

export async function writeAuditLog(params: {
  entityType: EntityType;
  entityId: string;
  actionType: ActionType;
  summary: string;
  actorUserId: string;
  // M1 新增（皆為可選，預設不帶入時行為與既有呼叫端完全相同）：供「原值→新值＋原因代碼」類事件（如 M3 起的 TeamReassigned）結構化保存
  fromValue?: string;
  toValue?: string;
  reasonCode?: string;
}) {
  return prisma.auditLog.create({
    data: {
      entityType: params.entityType,
      entityId: params.entityId,
      actionType: params.actionType,
      summary: params.summary,
      actorUserId: params.actorUserId,
      fromValue: params.fromValue,
      toValue: params.toValue,
      reasonCode: params.reasonCode,
    },
  });
}
