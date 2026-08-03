import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { loadHotfixPageContext, buildApprovalReviewViewData, HotfixPageNotApplicableError, type HotfixPageContext } from "@/lib/hotfix-ui/pageContext";
import { listHotfixAttachments } from "@/lib/hotfix-ui/attachmentService";
import { loadGovernanceRelationViewForActor } from "@/lib/issue-relations/viewService";
import { hasMeaningfulRichTextContent, getRichTextPlainText } from "@/lib/rich-text/value";
import { hotfixPriorityDefOf } from "@/lib/hotfix-ui/priority";
import { formatDate } from "@/lib/datetime";
import HotfixStageShell from "@/components/hotfix-nine-stage/HotfixStageShell";
import AttachmentSection from "@/components/hotfix-nine-stage/AttachmentSection";
import ApprovalReviewPanel from "@/components/hotfix-nine-stage/ApprovalReviewPanel";
import ExpandableContentBlock from "@/components/ui/ExpandableContentBlock";

// 「送簽摘要」只整理既有 Hotfix 資料（問題描述／影響範圍／風險與緊急性／預計完成日／送簽
// 佐證數量），不新增任何輸入欄位，也不重複顯示基本資訊卡已有的申請人／團隊／單號。
function SubmissionSummary({ ctx, attachmentCount, incidentCount, rcaCount, projectCount }: {
  ctx: HotfixPageContext;
  attachmentCount: number;
  incidentCount: number;
  rcaCount: number;
  projectCount: number;
}) {
  const info = ctx.ticketBasicInfo;
  const priorityDef = hotfixPriorityDefOf(info.hotfixPriority);
  const hasDescription = hasMeaningfulRichTextContent(info.description);
  const hasAnyContent = hasDescription || !!info.systemName || !!info.environment || !!info.riskLevel || !!priorityDef || !!info.dueDate;

  if (!hasAnyContent) {
    return (
      <section className="ui-card p-4">
        <h2 className="text-sm font-semibold text-text-primary">送簽摘要</h2>
        <p className="mt-2 text-sm text-text-muted">目前沒有額外送簽說明，請依工單基本資訊進行確認。</p>
      </section>
    );
  }

  return (
    <section className="ui-card p-5 sm:p-6">
      <h2 className="text-base font-semibold text-text-primary">送簽摘要</h2>
      <dl className="mt-4 space-y-4 text-sm">
        <div>
          <dt className="text-xs font-medium text-text-muted">申請事由／問題摘要</dt>
          <dd className="mt-1">
            {hasDescription ? (
              <ExpandableContentBlock text={getRichTextPlainText(info.description)} characterThreshold={220} />
            ) : (
              <span className="text-text-muted">尚未提供</span>
            )}
          </dd>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium text-text-muted">影響範圍</dt>
            <dd className="mt-1 text-text-primary">
              系統：{info.systemName || "未提供"}／環境：{info.environment || "未提供"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-text-muted">風險與緊急性</dt>
            <dd className="mt-1 text-text-primary">
              風險等級：{info.riskLevel || "未提供"}
              {priorityDef && `／緊急程度：${priorityDef.label}`}
            </dd>
            {priorityDef && <dd className="mt-1 text-xs leading-5 text-text-secondary">{priorityDef.description}</dd>}
          </div>
        </div>
        <div>
          <dt className="text-xs font-medium text-text-muted">預計完成日</dt>
          <dd className="mt-1 text-text-primary">{info.dueDate ? formatDate(info.dueDate) : "未設定"}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-text-muted">送簽佐證</dt>
          <dd className="mt-1 text-text-primary">
            附件 {attachmentCount} 件・關聯事件通報 {incidentCount} 件・關聯 RCA {rcaCount} 件・所屬季度專案 {projectCount} 件
          </dd>
        </div>
      </dl>
    </section>
  );
}

export default async function HotfixApprovalRequesterPage({ params }: { params: { id: string } }) {
  const actor = await requireCurrentUser();

  let ctx;
  try {
    ctx = await loadHotfixPageContext(params.id, actor, ["pendingBusinessApproval"]);
  } catch (err) {
    if (err instanceof HotfixPageNotApplicableError) redirect(`/issues/${params.id}`);
    throw err;
  }
  if (ctx.redirectTo) redirect(ctx.redirectTo);

  const review = await buildApprovalReviewViewData(ctx);

  const [attachments, relationView] = await Promise.all([
    listHotfixAttachments(params.id, { actorId: actor.id, currentStageKey: ctx.runtime.currentStage.stageKey }),
    loadGovernanceRelationViewForActor(actor.id, params.id),
  ]);
  const countOf = (key: "incident" | "rca" | "project") =>
    relationView.groups.find((group) => group.key === key)?.items.filter((item) => !item.isCurrent).length ?? 0;

  return (
    <HotfixStageShell
      title="申請人直屬主管簽核"
      subtitle="請確認工單基本資訊後同意或駁回"
      nineStageIndex={ctx.nineStageIndex}
      cancelled={ctx.cancelled}
      ticketBasicInfo={ctx.ticketBasicInfo}
      backHref="/issues?view=hotfix"
      ctx={ctx}
      main={<SubmissionSummary
        ctx={ctx}
        attachmentCount={attachments.length}
        incidentCount={countOf("incident")}
        rcaCount={countOf("rca")}
        projectCount={countOf("project")}
      />}
      side={<div className="space-y-5">
        <AttachmentSection issueId={params.id} items={attachments} readOnly canUpload={false} />
        {review ? <ApprovalReviewPanel
        issueId={params.id}
        approvalRecordId={review.approvalRecordId}
        roleLabel="申請人直屬主管"
        requestedByName={review.requestedByName}
        requestedAt={review.requestedAt}
        isResponsible={review.isResponsible}
        expectedApproverLabel={review.expectedApproverLabel}
        /> : <MissingApprovalRecordNotice />}
      </div>}
    />
  );
}

function MissingApprovalRecordNotice() {
  return <section className="ui-card p-4"><h2 className="text-sm font-semibold text-text-primary">簽核紀錄暫不可用</h2><p className="mt-2 text-sm text-text-secondary">目前沒有可顯示的有效簽核紀錄，因此不提供同意或駁回操作。</p></section>;
}
