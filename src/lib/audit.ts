import { prisma } from "./prisma";

export type ActionType =
  | "IssueCreated"
  | "StatusChange"
  | "FieldChange"
  | "CommentAdded"
  | "EvidenceAdded"
  | "AiSuggestion"
  | "RoleChange"
  | "AccountStatusChange";

export type EntityType = "Issue" | "User";

export async function writeAuditLog(params: {
  entityType: EntityType;
  entityId: string;
  actionType: ActionType;
  summary: string;
  actorUserId: string;
}) {
  return prisma.auditLog.create({
    data: {
      entityType: params.entityType,
      entityId: params.entityId,
      actionType: params.actionType,
      summary: params.summary,
      actorUserId: params.actorUserId,
    },
  });
}
