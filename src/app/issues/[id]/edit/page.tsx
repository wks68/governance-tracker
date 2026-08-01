import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { updateIssueAction } from "@/lib/actions";
import { requireCurrentUser } from "@/lib/auth";
import { issueTypeLabel, ENVIRONMENTS, RISK_LEVELS, PRIORITIES, SYSTEM_NAME_OPTIONS } from "@/lib/constants";
import { getVisibleFieldTemplate } from "@/lib/workflow";
import { getIssueWorkflowRuntime, isIssueOnVersionedWorkflow } from "@/lib/workflowExecutionService";
import { resolveIssueDetailHref } from "@/lib/issue-detail-href";
import { resolveIssueCreationScope, listSelectableApplicants } from "@/lib/team-applicant/issueCreationScope";
import DynamicFieldsForm, { DynamicOption } from "@/components/DynamicFieldsForm";
import EditIssueTeamApplicantField from "./EditIssueTeamApplicantField";

export const dynamic = "force-dynamic";

const inputCls = "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none";
const labelCls = "mb-1 block text-sm font-medium text-gray-700";

export default async function EditIssuePage({ params }: { params: { id: string } }) {
  const actor = await requireCurrentUser();
  const issue = await prisma.issue.findUnique({ where: { id: params.id }, include: { fieldValues: true } });
  if (!issue) notFound();

  // 建立工單／團隊整合修正：Hotfix 已啟動新版流程引擎者，一律只能透過九階段獨立頁面編輯
  // （stage1「Hotfix 建立工單」草稿頁，或 Admin 專用改派面板），不得再透過這個通用編輯頁
  // 繞過關卡限制直接修改團隊／申請人／基本欄位。
  let detailHref = resolveIssueDetailHref({ id: issue.id, issueType: issue.issueType, workflowStatus: issue.workflowStatus });
  if (issue.issueType === "Hotfix" && isIssueOnVersionedWorkflow(issue)) {
    const runtime = await getIssueWorkflowRuntime(issue.id, actor.id);
    if (runtime.onVersionedWorkflow) {
      detailHref = resolveIssueDetailHref({ id: issue.id, issueType: issue.issueType, currentStageKey: runtime.currentStage.stageKey, workflowStatus: issue.workflowStatus });
    }
    redirect(detailHref);
  }

  const fieldsMap: Record<string, string> = {};
  for (const f of issue.fieldValues) fieldsMap[f.fieldKey] = f.fieldValue;
  const template = getVisibleFieldTemplate(issue.issueType, issue.workflowStatus);
  const updateWithId = updateIssueAction.bind(null, issue.id);
  const scope = await resolveIssueCreationScope(actor.id);
  const formTeamId = scope.fixedTeamId ?? issue.assignedTeamId ?? "";
  const initialApplicants =
    formTeamId && scope.canChooseApplicant && !scope.blockedReason
      ? await listSelectableApplicants(actor.id, formTeamId).catch(() => undefined)
      : scope.fixedApplicant
        ? [scope.fixedApplicant]
        : undefined;

  // 動態欄位若設定 dynamicOptionsRole（例如 RD 自測人下拉選單），依角色從已啟用使用者中查詢選項
  const dynamicOptions: Record<string, DynamicOption[]> = {};
  const rolesNeeded = Array.from(new Set(template.map((f) => f.dynamicOptionsRole).filter((r): r is string => !!r)));
  for (const role of rolesNeeded) {
    const roleUsers = await prisma.user.findMany({
      where: { isActive: true, role },
      orderBy: { name: "asc" },
      select: { name: true },
    });
    for (const f of template) {
      if (f.dynamicOptionsRole === role) {
        dynamicOptions[f.key] = roleUsers.map((u) => ({ value: u.name, label: u.name }));
      }
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">編輯工單</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          {issue.issueKey} · {issueTypeLabel(issue.issueType)}
        </p>
      </div>

      <form action={updateWithId} className="space-y-6">
        <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-700">基本欄位</h2>
          <div>
            <label className={labelCls}>
              工單類型<span className="ml-1 text-danger">*</span>
            </label>
            <input value={issueTypeLabel(issue.issueType)} readOnly disabled className={`${inputCls} bg-gray-100`} />
          </div>
          <div>
            <label className={labelCls}>
              標題<span className="ml-1 text-danger">*</span>
            </label>
            <input name="title" required defaultValue={issue.title} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>
              問題現象<span className="ml-1 text-danger">*</span>
            </label>
            <textarea name="description" required rows={3} defaultValue={issue.description} className={inputCls} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>
                系統名稱<span className="ml-1 text-danger">*</span>
              </label>
              <select name="systemName" required defaultValue={issue.systemName} className={inputCls}>
                <option value="">請選擇</option>
                {SYSTEM_NAME_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>
                環境<span className="ml-1 text-danger">*</span>
              </label>
              <select name="environment" required defaultValue={issue.environment} className={inputCls}>
                <option value="">請選擇</option>
                {ENVIRONMENTS.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>
                風險等級<span className="ml-1 text-danger">*</span>
              </label>
              <select name="riskLevel" required defaultValue={issue.riskLevel} className={inputCls}>
                <option value="">請選擇</option>
                {RISK_LEVELS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>優先級</label>
              <select name="priority" defaultValue={issue.priority} className={inputCls}>
                <option value="">請選擇</option>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>
                預計完成日<span className="ml-1 text-danger">*</span>
              </label>
              <input type="date" name="dueDate" required defaultValue={issue.dueDate ? issue.dueDate.toISOString().slice(0, 10) : ""} className={inputCls} />
            </div>
          </div>
          <EditIssueTeamApplicantField
            scope={scope}
            initialTeamId={issue.assignedTeamId ?? ""}
            initialApplicantId={issue.reporterUserId ?? ""}
            initialApplicants={initialApplicants}
          />
        </section>

        <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-700">{issueTypeLabel(issue.issueType)} 專屬欄位</h2>
          <DynamicFieldsForm template={template} values={fieldsMap} dynamicOptions={dynamicOptions} />
        </section>

        <div className="flex gap-3">
          <button type="submit" disabled={scope.blockedReason !== null} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-40">
            儲存
          </button>
          <a
            href={detailHref}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            取消
          </a>
        </div>
      </form>
    </div>
  );
}
