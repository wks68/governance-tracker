import { prisma } from "../prisma";
import { listActionableTasksForActor, type ActionableIssueTask } from "./actionabilityService";

export type WorkflowTaskNotificationType =
  | "HOTFIX_SUPERVISOR_APPROVAL_REQUIRED"
  | "HOTFIX_ACTION_REQUIRED";

/**
 * In-app notification view model.
 *
 * 專案目前沒有 Notification table，且本功能不得修改 Prisma Schema。因此核准通知的
 * durable record 就是與 Workflow stage entry 同一 transaction 建立的 ApprovalRecord；
 * 這個 View Model 只把既有正式 responsibility/actionability 轉成 Bell、Toast 與待辦共用
 * 的輸出，不建立第二套權限或責任判斷。
 */
export interface WorkflowTaskNotification {
  notificationId: string;
  notificationType: WorkflowTaskNotificationType;
  sourceRecordId: string | null;
  recipientUserId: string;
  issueId: string;
  issueKey: string;
  issueTitle: string;
  applicantName: string;
  notificationTitle: string;
  message: string;
  actionKind: ActionableIssueTask["action"];
  actionLabel: string;
  actionHref: string;
  currentStageLabel: string;
  enteredAt: string | null;
  unread: true;
}

function notificationIdFor(actorId: string, task: ActionableIssueTask): string {
  const responsibilityIdentity =
    task.summary.actionSourceId ??
    `${task.issueId}:${task.summary.stageKey}:${task.enteredAt?.toISOString() ?? "current"}`;
  return `workflow-task:${actorId}:${task.action}:${responsibilityIdentity}`;
}

export async function resolveWorkflowTaskNotificationsForActor(
  actorId: string,
  tasks: readonly ActionableIssueTask[],
): Promise<WorkflowTaskNotification[]> {
  if (tasks.length === 0) return [];

  const issueIds = [...new Set(tasks.map((task) => task.issueId))];
  const approvalRecordIds = [
    ...new Set(
      tasks
        .map((task) => task.summary.actionSourceId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const [issues, approvalRecords] = await Promise.all([
    prisma.issue.findMany({
      where: { id: { in: issueIds } },
      select: { id: true, reporter: true },
    }),
    approvalRecordIds.length > 0
      ? prisma.approvalRecord.findMany({
          where: { id: { in: approvalRecordIds } },
          select: { id: true, requestedAt: true },
        })
      : Promise.resolve([]),
  ]);
  const applicantByIssueId = new Map(issues.map((issue) => [issue.id, issue.reporter]));
  const requestedAtByApprovalId = new Map(
    approvalRecords.map((record) => [record.id, record.requestedAt]),
  );

  return tasks.map((task) => {
    const applicantName = applicantByIssueId.get(task.issueId) ?? "申請人";
    const supervisorApproval =
      task.action === "APPROVE" && task.summary.stageKey === "pendingBusinessApproval";
    const sourceRecordId = task.summary.actionSourceId;
    const enteredAt = sourceRecordId
      ? requestedAtByApprovalId.get(sourceRecordId)?.toISOString() ?? task.enteredAt?.toISOString() ?? null
      : task.enteredAt?.toISOString() ?? null;

    return {
      notificationId: notificationIdFor(actorId, task),
      notificationType: supervisorApproval
        ? "HOTFIX_SUPERVISOR_APPROVAL_REQUIRED"
        : "HOTFIX_ACTION_REQUIRED",
      sourceRecordId,
      recipientUserId: actorId,
      issueId: task.issueId,
      issueKey: task.issueKey,
      issueTitle: task.title,
      applicantName,
      notificationTitle: supervisorApproval ? "Hotfix 待主管核准" : "新的 Hotfix 待辦",
      message: supervisorApproval
        ? `${applicantName} 建立了 ${task.issueKey}，目前等待你的主管核准。`
        : `${task.issueKey} 正在等待你${task.actionLabel}。`,
      actionKind: task.action,
      actionLabel: supervisorApproval ? "查看並核准" : task.actionLabel,
      actionHref: task.actionHref,
      currentStageLabel: task.currentStageLabel,
      enteredAt,
      unread: true,
    };
  });
}

export async function listWorkflowTaskNotificationsForActor(
  actorId: string,
): Promise<WorkflowTaskNotification[]> {
  const tasks = await listActionableTasksForActor(actorId);
  return resolveWorkflowTaskNotificationsForActor(actorId, tasks);
}
