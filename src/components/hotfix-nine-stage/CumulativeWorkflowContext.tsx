import { prisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/datetime";
import {
  RD_FIX_FIELDS,
  QA_VERIFY_FIELDS,
  OP_DEPLOY_FIELDS,
  OP_RESULT_FIELDS,
  displayExecutionValue,
  type ExecutionFieldDef,
} from "@/lib/hotfix-ui/executionFields";
import type { HotfixPageContext } from "@/lib/hotfix-ui/pageContext";

const APPROVAL_LABELS: Record<string, string> = {
  pendingBusinessApproval: "申請人主管核准",
  pendingRdLeadApproval: "RD 修正與自測／RD 主管核准",
  pendingQaLeadApproval: "QA 驗證／QA 主管核准",
  pendingDeploymentApproval: "OP 上版前確認／主管核准",
  opCompleted: "正式環境部署紀錄／OP 主管上版後確認",
};

const FIELD_DEFS: Record<string, readonly ExecutionFieldDef[]> = {
  pendingRdLeadApproval: RD_FIX_FIELDS,
  pendingQaLeadApproval: QA_VERIFY_FIELDS,
  pendingDeploymentApproval: OP_DEPLOY_FIELDS,
  opCompleted: OP_RESULT_FIELDS,
};

function decisionLabel(decision: string): string {
  if (decision === "APPROVED") return "同意";
  if (decision === "REJECTED") return "駁回";
  if (decision === "CANCELLED") return "已取消";
  return "等待核准";
}

function readSnapshot(value: string | undefined): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as { values?: Record<string, unknown> };
    if (!parsed.values || typeof parsed.values !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed.values)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    );
  } catch {
    return {};
  }
}

export default async function CumulativeWorkflowContext({ ctx }: { ctx: HotfixPageContext }) {
  const [records, snapshots, history] = await Promise.all([
    prisma.approvalRecord.findMany({
      where: { issueId: ctx.issue.id },
      orderBy: [{ requestedAt: "asc" }, { revisionNo: "asc" }],
      include: {
        requestedBy: true,
        approver: true,
        approverTeam: true,
        expectedApprover: true,
        delegatedFrom: true,
        supersededBy: true,
      },
    }),
    prisma.issueFieldValue.findMany({ where: { issueId: ctx.issue.id } }),
    prisma.issueWorkflowStageHistory.findMany({
      where: { issueId: ctx.issue.id },
      orderBy: { executedAt: "asc" },
      include: { fromStage: true, toStage: true, assignedTeamAfter: true },
    }),
  ]);

  const actorIds = Array.from(new Set(history.map((row) => row.actorUserId)));
  const actors = actorIds.length ? await prisma.user.findMany({ where: { id: { in: actorIds } } }) : [];
  const actorNames = new Map(actors.map((actor) => [actor.id, actor.name]));
  const snapshotByRecord = new Map<string, Record<string, string>>();
  const legacyCurrentValues = Object.fromEntries(
    snapshots
      .filter((row) => !row.fieldKey.startsWith("workflowSubmission:"))
      .map((row) => [row.fieldKey, row.fieldValue]),
  );
  for (const row of snapshots.filter((item) => item.fieldKey.startsWith("workflowSubmission:"))) {
    const recordId = row.fieldKey.split(":").at(-1);
    if (recordId) snapshotByRecord.set(recordId, readSnapshot(row.fieldValue));
  }

  if (records.length === 0 && history.length <= 1) return null;

  return (
    <>
      {records.length > 0 && (
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-800">前序關卡紀錄</h2>
          <p className="mt-1 text-xs text-gray-500">只顯示已正式提交的內容；最近一筆預設展開，舊輪次與駁回紀錄均保留。</p>
          <div className="mt-3 space-y-2">
            {records.map((record, index) => {
              const fields = FIELD_DEFS[record.relatedStageKey] ?? [];
              // 舊 Preview 資料建立於提交快照功能之前，才使用目前欄位作唯讀相容顯示；
              // 新送出紀錄一律有 record-id 快照，不會在補正時被草稿覆蓋。
              const values = snapshotByRecord.get(record.id) ?? legacyCurrentValues;
              const populated = fields.filter((field) => values[field.key]?.trim());
              return (
                <details key={record.id} open={index === records.length - 1} className="rounded-md border border-gray-200">
                  <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-gray-800">
                    {APPROVAL_LABELS[record.relatedStageKey] ?? "主管核准"} · 第 {record.revisionNo} 次提交 · {decisionLabel(record.decision)}
                  </summary>
                  <div className="border-t border-gray-100 px-3 py-3">
                    <dl className="grid gap-3 text-sm sm:grid-cols-2">
                      <div><dt className="text-xs text-gray-400">執行人／提交人</dt><dd>{record.requestedBy.name}</dd></div>
                      <div><dt className="text-xs text-gray-400">提交時間</dt><dd>{formatDateTime(record.requestedAt)}</dd></div>
                      <div><dt className="text-xs text-gray-400">核准結果</dt><dd>{decisionLabel(record.decision)}</dd></div>
                      <div><dt className="text-xs text-gray-400">核准人</dt><dd>{record.approver?.name ?? "等待核准"}</dd></div>
                      <div><dt className="text-xs text-gray-400">核准身分／團隊</dt><dd>{record.approverTeam?.name ?? record.approvalAuthorityType ?? "—"}</dd></div>
                      <div><dt className="text-xs text-gray-400">核准時間</dt><dd>{formatDateTime(record.decidedAt)}</dd></div>
                      <div><dt className="text-xs text-gray-400">是否代理核准</dt><dd>{record.approvalAuthorityType === "DELEGATE" ? "是" : "否"}</dd></div>
                      <div><dt className="text-xs text-gray-400">原應核准人</dt><dd>{record.delegatedFrom?.name ?? record.expectedApprover?.name ?? "—"}</dd></div>
                      <div className="sm:col-span-2"><dt className="text-xs text-gray-400">核准意見／駁回原因</dt><dd className="whitespace-pre-wrap">{record.decisionComment || "—"}</dd></div>
                      <div className="sm:col-span-2"><dt className="text-xs text-gray-400">後續補正狀態</dt><dd>{record.supersededBy ? `已補正並第 ${record.supersededBy.revisionNo} 次送出` : record.decision === "REJECTED" ? "等待補正" : "—"}</dd></div>
                    </dl>
                    {populated.length > 0 && (
                      <dl className="mt-4 grid gap-3 border-t border-gray-100 pt-3 sm:grid-cols-2">
                        {populated.map((field) => (
                          <div key={field.key}>
                            <dt className="text-xs text-gray-400">{field.label}</dt>
                            <dd className="mt-0.5 whitespace-pre-wrap text-sm text-gray-800">{displayExecutionValue(values[field.key])}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        </section>
      )}

      {history.length > 1 && (
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-800">流程歷程</h2>
          <ol className="mt-3 space-y-2">
            {history.map((row) => (
              <li key={row.id} className="border-l-2 border-gray-200 pl-3 text-sm text-gray-700">
                <p>{row.fromStage ? `${row.fromStage.label} → ` : ""}{row.toStage.label}</p>
                <p className="text-xs text-gray-400">
                  {formatDateTime(row.executedAt)} · {actorNames.get(row.actorUserId) ?? "系統使用者"}
                  {row.assignedTeamAfter ? ` · ${row.assignedTeamAfter.name}` : ""}
                </p>
                {row.reasonCode && <p className="mt-0.5 whitespace-pre-wrap text-xs text-gray-500">{row.reasonCode}</p>}
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}
