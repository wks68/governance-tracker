import { hotfixRoute, routeForStageKey } from "./hotfix-ui/nineStage";
import { incidentRoute, isKnownIncidentStageKey } from "./incident-ui/incidentStage";
import { rcaRoute, isKnownRcaStageKey } from "./rca-ui/rcaStage";

export interface IssueDetailHrefSource {
  id: string;
  issueType: string;
  /** 正式來源為 Issue.currentWorkflowStage.stageKey；舊制 Issue 傳 null。 */
  currentStageKey?: string | null;
  /** 只供沒有正式 runtime 的舊制 closed／cancelled 判斷唯讀終態 route。 */
  workflowStatus?: string | null;
}

export function genericIssueDetailHref(issueId: string): string {
  return `/issues/${issueId}`;
}

/**
 * 全站 Issue「查看」連結的唯一 resolver。
 *
 * Hotfix 有正式 runtime 時只委派 nineStage.routeForStageKey，絕不重複 stage mapping；
 * 舊制 Hotfix 沒有 currentWorkflowStage 可解析，進完整九階段唯讀 summary；舊制終態進 close。
 * Incident 有正式 runtime 時進 incident-ui/incidentStage 唯一的動態詳情頁；其餘 issueType
 * 保留既有通用詳情路由。
 */
export function resolveIssueDetailHref(issue: IssueDetailHrefSource): string {
  if (issue.issueType === "Incident") {
    if (issue.currentStageKey && isKnownIncidentStageKey(issue.currentStageKey)) {
      return incidentRoute(issue.id);
    }
    return genericIssueDetailHref(issue.id);
  }

  if (issue.issueType === "RCA") {
    if (issue.currentStageKey && isKnownRcaStageKey(issue.currentStageKey)) {
      return rcaRoute(issue.id);
    }
    return genericIssueDetailHref(issue.id);
  }

  if (issue.issueType !== "Hotfix") return genericIssueDetailHref(issue.id);

  if (issue.currentStageKey) {
    const stageRoute = routeForStageKey(issue.id, issue.currentStageKey);
    if (stageRoute) return stageRoute;
  }

  if (issue.workflowStatus === "closed" || issue.workflowStatus === "cancelled") {
    return hotfixRoute(issue.id, "close");
  }

  return hotfixRoute(issue.id, "summary");
}
