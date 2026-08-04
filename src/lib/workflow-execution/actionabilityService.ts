import { prisma } from "../prisma";
import { resolveIssueDetailHref } from "../issue-detail-href";
import {
  evaluateCurrentActorTask,
  type ActorTaskSummary,
  type IssueActionKind,
} from "./responsibilityService";
// Incident 事件通報流程新增：與 Hotfix 版本分開維護的責任解析器（見
// src/lib/incident-ui/incidentResponsibilityService.ts 說明），回傳的 IncidentActorTaskSummary
// 與 ActorTaskSummary 欄位結構刻意保持一致，供本檔案以同一個 Map／清單型別呈現，不建立
// 第二套待辦資料結構。
import { evaluateCurrentIncidentActorTask } from "../incident-ui/incidentResponsibilityService";

const SUPPORTED_ISSUE_TYPES = ["Hotfix", "Incident"] as const;

async function evaluateActorTaskForIssueType(issueType: string, issueId: string, actorId: string): Promise<ActorTaskSummary | null> {
  if (issueType === "Incident") return evaluateCurrentIncidentActorTask(issueId, actorId);
  return evaluateCurrentActorTask(issueId, actorId);
}

export interface ActionableIssueSource {
  id: string;
  issueKey: string;
  title: string;
  issueType: string;
  workflowVersionId: string | null;
  currentWorkflowStageId: string | null;
  stageEnteredAt: Date | null;
}

export interface ActionableIssueTask {
  issueId: string;
  issueKey: string;
  title: string;
  issueType: string;
  action: Exclude<IssueActionKind, "VIEW_ONLY">;
  actionLabel: string;
  actionHref: string;
  currentStageLabel: string;
  enteredAt: Date | null;
  summary: ActorTaskSummary;
}

export interface ResolvedIssueTask {
  summary: ActorTaskSummary;
  actionable: ActionableIssueTask | null;
}

const ACTION_LABELS: Record<Exclude<IssueActionKind, "VIEW_ONLY">, string> = {
  CLAIM: "接單",
  ASSIGN_MEMBER: "指派成員",
  ENTER_WORK: "進入處理",
  APPROVE: "主管核准",
  CONFIRM_CLOSE: "確認結案",
};

/**
 * 導覽列通知與工單清單唯一共用的待辦解析入口。
 *
 * 是否可操作完全委派給 evaluateCurrentActorTask；這裡不以可見性、Admin 身分或前端旗標
 * 推導待辦。沒有實際操作權，或無法導向目前關卡操作頁的項目，一律不列入。
 */
export async function resolveIssueTasksForActor(
  actorId: string,
  issues: readonly ActionableIssueSource[],
): Promise<Map<string, ResolvedIssueTask>> {
  const targets = issues.filter(
    (issue) =>
      (SUPPORTED_ISSUE_TYPES as readonly string[]).includes(issue.issueType) &&
      issue.workflowVersionId !== null &&
      issue.currentWorkflowStageId !== null,
  );
  const resolved = await Promise.all(
    targets.map(async (issue) => {
      const summary = await evaluateActorTaskForIssueType(issue.issueType, issue.id, actorId);
      if (!summary) return null;
      const actionHref =
        summary.action === "VIEW_ONLY"
          ? null
          : resolveIssueDetailHref({ id: issue.id, issueType: issue.issueType, currentStageKey: summary.stageKey });
      const actionable =
        summary.action !== "VIEW_ONLY" && actionHref
          ? ({
              issueId: issue.id,
              issueKey: issue.issueKey,
              title: issue.title,
              issueType: issue.issueType,
              action: summary.action,
              actionLabel: ACTION_LABELS[summary.action],
              actionHref,
              currentStageLabel: summary.businessStatusLabel,
              enteredAt: issue.stageEnteredAt,
              summary,
            } satisfies ActionableIssueTask)
          : null;
      return {
        summary,
        actionable,
        issueId: issue.id,
      };
    }),
  );

  return new Map(
    resolved
      .filter((task): task is NonNullable<typeof task> => task !== null)
      .map(({ issueId, ...task }) => [issueId, task]),
  );
}

export async function resolveActionableTasksForActor(
  actorId: string,
  issues: readonly ActionableIssueSource[],
): Promise<Map<string, ActionableIssueTask>> {
  const resolved = await resolveIssueTasksForActor(actorId, issues);
  return new Map(
    Array.from(resolved.entries()).flatMap(([issueId, task]) =>
      task.actionable ? [[issueId, task.actionable] as const] : [],
    ),
  );
}

export async function listActionableTasksForActor(actorId: string): Promise<ActionableIssueTask[]> {
  const issues = await prisma.issue.findMany({
    where: {
      issueType: { in: [...SUPPORTED_ISSUE_TYPES] },
      workflowVersionId: { not: null },
      currentWorkflowStageId: { not: null },
    },
    orderBy: { stageEnteredAt: "asc" },
    select: {
      id: true,
      issueKey: true,
      title: true,
      issueType: true,
      workflowVersionId: true,
      currentWorkflowStageId: true,
      stageEnteredAt: true,
    },
  });
  const tasks = await resolveActionableTasksForActor(actorId, issues);
  return issues.flatMap((issue) => {
    const task = tasks.get(issue.id);
    return task ? [task] : [];
  });
}
