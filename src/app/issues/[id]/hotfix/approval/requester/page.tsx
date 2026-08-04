import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { loadHotfixPageContext, buildApprovalReviewViewData, HotfixPageNotApplicableError, type HotfixPageContext } from "@/lib/hotfix-ui/pageContext";
import { listHotfixAttachments } from "@/lib/hotfix-ui/attachmentService";
import { loadGovernanceRelationViewForActor } from "@/lib/issue-relations/viewService";
import { hasMeaningfulRichTextContent, getRichTextPlainText } from "@/lib/rich-text/value";
import { formatDate } from "@/lib/datetime";
import HotfixStageShell from "@/components/hotfix-nine-stage/HotfixStageShell";
import AttachmentSection from "@/components/hotfix-nine-stage/AttachmentSection";
import ApprovalReviewPanel from "@/components/hotfix-nine-stage/ApprovalReviewPanel";
import ExpandableContentBlock from "@/components/ui/ExpandableContentBlock";

// 「送簽摘要」只整理既有 Hotfix 資料（問題描述／影響範圍／預計完成日／送簽佐證數量），
// 不新增任何輸入欄位，也不重複顯示基本資訊卡已有的申請人／團隊／單號。左右兩欄呈現同一組
// 申請內容的兩個面向（原始描述／對應的影響摘要），不放與申請內容無直接對應的風險分析框
// ——風險等級／緊急程度已於「Hotfix 單基本資訊」卡完整呈現，這裡不重複顯示。
function SubmissionSummary({ ctx, attachmentCount, incidentCount, rcaCount, projectCount }: {
  ctx: HotfixPageContext;
  attachmentCount: number;
  incidentCount: number;
  rcaCount: number;
  projectCount: number;
}) {
  const info = ctx.ticketBasicInfo;
  const hasDescription = hasMeaningfulRichTextContent(info.description);
  const hasImpactSummary = !!info.systemName || !!info.environment;
  const hasAnyContent = hasDescription || hasImpactSummary || !!info.dueDate;

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
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium text-text-muted">申請事由／問題摘要</dt>
            <dd className="mt-1">
              {hasDescription ? (
                <ExpandableContentBlock text={getRichTextPlainText(info.description)} characterThreshold={220} />
              ) : (
                <span className="text-text-muted">尚未填寫</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-text-muted">影響摘要</dt>
            <dd className="mt-1 text-text-primary">
              {hasImpactSummary ? (
                <>系統：{info.systemName || "尚未填寫"}／環境：{info.environment || "尚未填寫"}</>
              ) : (
                <span className="text-text-muted">尚未填寫</span>
              )}
            </dd>
          </div>
        </div>
        <div>
          <dt className="text-xs font-medium text-text-muted">預計完成日</dt>
          <dd className="mt-1 text-text-primary">{info.dueDate ? formatDate(info.dueDate) : "尚未填寫"}</dd>
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
      approval={review ? <ApprovalReviewPanel
        issueId={params.id}
        approvalRecordId={review.approvalRecordId}
        stageLabel="申請人直屬主管簽核"
        roleLabel="申請人直屬主管"
        requestedByName={review.requestedByName}
        requestedAt={review.requestedAt}
        isResponsible={review.isResponsible}
        expectedApproverLabel={review.expectedApproverLabel}
      /> : <MissingApprovalRecordNotice />}
      attachments={<AttachmentSection issueId={params.id} items={attachments} readOnly canUpload={false} />}
    />
  );
}

function MissingApprovalRecordNotice() {
  return <section className="ui-card p-4"><h2 className="text-sm font-semibold text-text-primary">簽核紀錄暫不可用</h2><p className="mt-2 text-sm text-text-secondary">目前沒有可顯示的有效簽核紀錄，因此不提供同意或駁回操作。</p></section>;
}
