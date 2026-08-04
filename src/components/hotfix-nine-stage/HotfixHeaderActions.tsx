// 建立工單／團隊整合修正新增：Hotfix 九階段頁面共用的「取消／刪除／Admin 改派」動作列。
// Server Component：負責判斷目前使用者可執行哪些動作（唯讀判斷，實際寫入一律由對應
// Server Action／服務層現場重新授權），再把結果交給對應的 Client Component 呈現。

import { getUserHasCapability } from "@/lib/permissions";
import { isActorOriginalReporter, type HotfixPageContext } from "@/lib/hotfix-ui/pageContext";
import { canApplicantDeleteIssue, loadAdminDeleteImpactSummary } from "@/lib/issue-management/issueDeletionService";
import { listCreatableTeamsForActor } from "@/lib/team-applicant/teamApplicantService";
import DeleteOwnDraftButton from "./DeleteOwnDraftButton";
import CancelHotfixButton from "./CancelHotfixButton";
import AdminReassignPanel from "./AdminReassignPanel";
import AdminPermanentDeleteButton from "@/components/issue-management/AdminPermanentDeleteButton";

export default async function HotfixHeaderActions({ ctx }: { ctx: HotfixPageContext }) {
  const stageKey = ctx.runtime.currentStage.stageKey;
  const isReporter = isActorOriginalReporter(ctx);
  const isAdmin = await getUserHasCapability(ctx.actor, "admin.full");

  const nodes: React.ReactNode[] = [];

  if (!ctx.cancelled) {
    if (stageKey === "draft" && isReporter) {
      const check = await canApplicantDeleteIssue(ctx.issue.id, ctx.actor.id);
      if (check.allowed) {
        nodes.push(
          <DeleteOwnDraftButton key="delete" issueId={ctx.issue.id} issueKey={ctx.issue.issueKey} title={ctx.issue.title} modalTitle="刪除 Hotfix 工單" />,
        );
      }
    }

    if (stageKey !== "draft" && stageKey !== "closed" && (isReporter || isAdmin)) {
      nodes.push(<CancelHotfixButton key="cancel" issueId={ctx.issue.id} issueKey={ctx.issue.issueKey} />);
    }

    if (stageKey !== "draft" && stageKey !== "closed" && isAdmin) {
      const teams = await listCreatableTeamsForActor(ctx.actor.id);
      nodes.push(
        <AdminReassignPanel
          key="reassign"
          issueId={ctx.issue.id}
          teams={teams}
          currentTeamId={ctx.issue.assignedTeamId ?? ""}
          currentApplicantId={ctx.issue.reporterUserId ?? ""}
          currentApplicantName={ctx.issue.reporter}
        />,
      );
    }
  }

  // Admin 永久刪除：CRUD 管理權與流程簽核權分開，任何階段（含已取消）皆可使用，不受上方
  // 「已取消不提供操作」的限制影響。
  if (isAdmin) {
    const summary = await loadAdminDeleteImpactSummary(ctx.issue.id);
    nodes.push(<AdminPermanentDeleteButton key="admin-delete" issueId={ctx.issue.id} summary={summary} />);
  }

  if (nodes.length === 0) return null;

  return <div className="flex flex-wrap items-start gap-2">{nodes}</div>;
}
