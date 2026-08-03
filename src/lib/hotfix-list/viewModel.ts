import type { IssueActionKind } from "@/lib/workflow-execution/responsibilityService";

export type HotfixListActionVariant = "pending-approval" | "pending-work" | "view";
export type HotfixDueTone = "normal" | "due-soon" | "overdue" | "unset";
export type HotfixSummaryKey = "all" | "my-work" | "pending-approval" | "due-this-week";

export interface HotfixListActionView {
  variant: HotfixListActionVariant;
  label: "待核准" | "待處理" | "檢視";
  href: string;
}

export function resolveHotfixListAction(input: {
  actionKind?: IssueActionKind;
  actionHref?: string;
  detailHref: string;
  terminal?: boolean;
}): HotfixListActionView {
  if (input.terminal) return { variant: "view", label: "檢視", href: input.detailHref };
  if (input.actionKind === "APPROVE" && input.actionHref) {
    return { variant: "pending-approval", label: "待核准", href: input.actionHref };
  }
  if (input.actionKind && input.actionKind !== "VIEW_ONLY" && input.actionHref) {
    return { variant: "pending-work", label: "待處理", href: input.actionHref };
  }
  return { variant: "view", label: "檢視", href: input.detailHref };
}

export function resolveHotfixTerminal(input: {
  hasRuntime: boolean;
  currentStageTerminalOutcome?: string | null;
  workflowStatus: string;
}): boolean {
  if (input.hasRuntime) {
    return input.currentStageTerminalOutcome === "COMPLETED" || input.currentStageTerminalOutcome === "CANCELLED";
  }
  const status = input.workflowStatus.toLowerCase();
  return status === "closed" || status === "cancelled";
}

export function resolveResponsibilityLine(input: {
  terminal: boolean;
  waitingRole?: string | null;
  executorName?: string | null;
  assignedTeamName?: string | null;
}): string | null {
  if (input.terminal) return null;
  const waitingRole = input.waitingRole?.trim();
  if (waitingRole && waitingRole !== "—") return `等待角色：${waitingRole}`;
  const executor = input.executorName?.trim();
  if (executor) return `執行人：${executor}`;
  const team = input.assignedTeamName?.trim();
  if (team) return `承接團隊：${team}`;
  return null;
}

export function taipeiWeekBounds(now = new Date()): { start: number; end: number } {
  const offset = 8 * 60 * 60 * 1000;
  const local = new Date(now.getTime() + offset);
  const day = local.getUTCDay() || 7;
  const localMidnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const start = localMidnight - (day - 1) * 86_400_000 - offset;
  return { start, end: start + 7 * 86_400_000 };
}

export function isDueThisWeek(dueDate: string | null, terminal: boolean, bounds: { start: number; end: number }): boolean {
  if (!dueDate || terminal) return false;
  const time = new Date(dueDate).getTime();
  return Number.isFinite(time) && time >= bounds.start && time < bounds.end;
}

export function resolveHotfixDueTone(
  dueDate: string | null,
  terminal: boolean,
  now: number,
  bounds: { start: number; end: number },
): HotfixDueTone {
  if (!dueDate) return "unset";
  if (terminal) return "normal";
  const time = new Date(dueDate).getTime();
  if (!Number.isFinite(time)) return "normal";
  if (time < now) return "overdue";
  if (time >= bounds.start && time < bounds.end) return "due-soon";
  return "normal";
}

export function normalizeHotfixSummaryKey(value?: string): HotfixSummaryKey {
  if (value === "my-work" || value === "pending-approval" || value === "due-this-week") return value;
  return "all";
}

export interface HotfixListFilterSource {
  issueKey: string;
  title: string;
  systemName: string;
  dueDate: string | null;
  terminal: boolean;
  hotfixAction?: HotfixListActionView;
}

export function matchesHotfixSearch(row: Pick<HotfixListFilterSource, "issueKey" | "title" | "systemName">, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase("zh-TW");
  if (!normalized) return true;
  return [row.issueKey, row.title, row.systemName]
    .some((value) => value.toLocaleLowerCase("zh-TW").includes(normalized));
}

export function matchesHotfixSummary(
  row: HotfixListFilterSource,
  key: HotfixSummaryKey,
  bounds: { start: number; end: number },
): boolean {
  if (key === "my-work") return row.hotfixAction?.variant === "pending-work";
  if (key === "pending-approval") return row.hotfixAction?.variant === "pending-approval";
  if (key === "due-this-week") return isDueThisWeek(row.dueDate, row.terminal, bounds);
  return true;
}

export function summarizeHotfixList(
  rows: readonly HotfixListFilterSource[],
  bounds: { start: number; end: number },
): { total: number; work: number; approval: number; due: number } {
  return {
    total: rows.length,
    work: rows.filter((row) => row.hotfixAction?.variant === "pending-work").length,
    approval: rows.filter((row) => row.hotfixAction?.variant === "pending-approval").length,
    due: rows.filter((row) => isDueThisWeek(row.dueDate, row.terminal, bounds)).length,
  };
}
