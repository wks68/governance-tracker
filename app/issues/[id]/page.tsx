import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  FileCheck2,
  GitBranch,
  History,
  LinkIcon,
  MessageSquare,
  Save,
  ShieldCheck
} from "lucide-react";
import { DynamicFieldForm } from "@/components/dynamic-field-form";
import {
  CheckboxField,
  EnvironmentField,
  PriorityField,
  RiskLevelField,
  RoleField,
  SelectField,
  TextAreaField,
  TextField
} from "@/components/form-controls";
import { StatusBadge } from "@/components/status-badge";
import { WorkflowProgress } from "@/components/workflow-progress";
import {
  addCommentAction,
  addEvidenceAction,
  generateAiSuggestionAction,
  transitionIssueAction,
  updateIssueAction
} from "@/lib/actions";
import { AI_SUGGESTION_TYPES } from "@/lib/ai";
import { db } from "@/lib/db";
import { getWorkflow, ROLES } from "@/lib/governance";
import {
  AI_DISCLAIMER,
  displayActionType,
  displayAiSuggestionType,
  displayBlockReason,
  displayEvidenceStatus,
  displayGateItem,
  displayIssueType,
  displayNextStep,
  displayOption,
  displayRole,
  displayWorkflowStatus
} from "@/lib/i18n";
import { evaluateGateRules, isCriticalMonitoringUnanswered } from "@/lib/rules";
import { fieldMap, formatDate, formatDateTime, toDateInputValue } from "@/lib/utils";

export const dynamic = "force-dynamic";

type IssueDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type ResolvedSearchParams = Awaited<IssueDetailPageProps["searchParams"]>;

async function currentRole() {
  const cookieStore = await cookies();
  const role = cookieStore.get("dmsRole")?.value ?? "Admin";
  return ROLES.includes(role as (typeof ROLES)[number]) ? role : "Admin";
}

function param(searchParams: ResolvedSearchParams, key: string) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function ActorInputs({ role }: { role: string }) {
  return (
    <>
      <input type="hidden" name="actorRole" value={role} />
      <input type="hidden" name="actorName" value="MVP User" />
    </>
  );
}

function GateList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div>
      <ul className="mt-2 space-y-1 text-sm text-slate-700">
        {items.length > 0 ? (
          items.map((item) => <li key={item}>- {displayGateItem(item)}</li>)
        ) : (
          <li>- 無</li>
        )}
      </ul>
    </div>
  );
}

export default async function IssueDetailPage({ params, searchParams }: IssueDetailPageProps) {
  const [{ id }, resolvedSearchParams, role] = await Promise.all([
    params,
    searchParams,
    currentRole()
  ]);
  const issue = await db.issue.findUnique({
    where: { id },
    include: {
      fieldValues: true,
      evidence: {
        orderBy: { createdAt: "desc" }
      },
      comments: {
        orderBy: { createdAt: "desc" }
      },
      auditLogs: {
        orderBy: { createdAt: "desc" }
      },
      aiSuggestions: {
        orderBy: { createdAt: "desc" }
      }
    }
  });

  if (!issue) {
    notFound();
  }

  const values = fieldMap(issue.fieldValues);
  const workflow = getWorkflow(issue.issueType);
  const gate = evaluateGateRules(issue);
  const updateAction = updateIssueAction.bind(null, issue.id);
  const transitionAction = transitionIssueAction.bind(null, issue.id);
  const commentAction = addCommentAction.bind(null, issue.id);
  const evidenceAction = addEvidenceAction.bind(null, issue.id);
  const aiAction = generateAiSuggestionAction.bind(null, issue.id);
  const error = param(resolvedSearchParams, "error");

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <Link
            href="/issues"
            className="mt-1 inline-flex h-9 w-9 items-center justify-center rounded-md border border-line bg-white text-slate-700 hover:bg-slate-50"
            aria-label="回到議題清單"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-slate-950">{issue.issueKey}</h1>
              <StatusBadge
                statusLight={issue.statusLight}
                pulse={issue.statusLight === "Red" && isCriticalMonitoringUnanswered(issue)}
              />
              <span className="rounded-md border border-line bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
                {displayIssueType(issue.issueType)}
              </span>
            </div>
            <p className="mt-1 text-lg font-medium text-slate-900">{issue.title}</p>
            <p className="mt-1 text-sm text-slate-500">
              {displayWorkflowStatus(issue.workflowStatus)} / {issue.ownerName} (
              {displayRole(issue.ownerRole)}) / 到期 {formatDate(issue.dueDate)}
            </p>
          </div>
        </div>

        <form action={transitionAction} className="rounded-lg border border-line bg-white p-3 shadow-panel">
          <ActorInputs role={role} />
          <div className="grid gap-2 sm:grid-cols-[240px_auto]">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                流程狀態
              </span>
              <select
                name="targetStatus"
                defaultValue={issue.workflowStatus}
                className="mt-1 h-9 w-full rounded-md border border-line bg-white px-2 text-sm text-slate-900 outline-none focus:border-delta-600 focus:ring-2 focus:ring-delta-100"
              >
                {workflow.map((status) => (
                  <option key={status} value={status}>
                    {displayWorkflowStatus(status)}
                  </option>
                ))}
              </select>
            </label>
            <button className="mt-5 inline-flex h-9 items-center justify-center gap-2 rounded-md bg-delta-700 px-4 text-sm font-semibold text-white hover:bg-delta-800">
              <GitBranch className="h-4 w-4" />
              移動
            </button>
          </div>
        </form>
      </div>

      {error ? (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      ) : null}

      <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-950">流程進度</h2>
        </div>
        <div className="mt-4">
          <WorkflowProgress workflow={workflow} currentStatus={issue.workflowStatus} />
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.3fr_0.7fr]">
        <form action={updateAction} className="space-y-5">
          <ActorInputs role={role} />
          <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
            <h2 className="text-sm font-semibold text-slate-950">基本欄位</h2>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <TextField name="title" label="標題" defaultValue={issue.title} required />
              <TextField name="systemName" label="系統名稱" defaultValue={issue.systemName} required />
              <EnvironmentField defaultValue={issue.environment} />
              <RiskLevelField defaultValue={issue.riskLevel} />
              <PriorityField defaultValue={issue.priority} />
              <RoleField name="ownerRole" label="負責角色" defaultValue={issue.ownerRole} />
              <TextField name="ownerName" label="負責人" defaultValue={issue.ownerName} required />
              <TextField name="reporter" label="回報人" defaultValue={issue.reporter} required />
              <TextField
                name="dueDate"
                label="到期日"
                type="date"
                defaultValue={toDateInputValue(issue.dueDate)}
                required
              />
              <SelectField
                name="waitingRole"
                label="等候角色"
                defaultValue={issue.waitingRole}
                includeEmpty
                emptyLabel="無"
                options={ROLES}
                optionLabel={displayRole}
              />
              <div className="grid gap-3 sm:grid-cols-3 lg:col-span-2">
                <CheckboxField name="needRca" label="需要 RCA" defaultChecked={issue.needRca} />
                <CheckboxField
                  name="needRiskException"
                  label="需要風險例外"
                  defaultChecked={issue.needRiskException}
                />
                <CheckboxField
                  name="impactProduction"
                  label="影響生產"
                  defaultChecked={issue.impactProduction}
                />
              </div>
              <div className="lg:col-span-2">
                <TextAreaField name="description" label="說明" defaultValue={issue.description} required />
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
            <h2 className="text-sm font-semibold text-slate-950">動態欄位</h2>
            <div className="mt-4">
              <DynamicFieldForm issueType={issue.issueType} values={values} />
            </div>
          </section>

          <div className="flex justify-end">
            <button className="inline-flex h-10 items-center gap-2 rounded-md bg-delta-700 px-4 text-sm font-semibold text-white hover:bg-delta-800">
              <Save className="h-4 w-4" />
              儲存變更
            </button>
          </div>
        </form>

        <div className="space-y-5">
          <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              <h2 className="text-sm font-semibold text-slate-950">關卡規則檢查</h2>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <span
                className={
                  gate.passed
                    ? "rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700"
                    : "rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700"
                }
              >
                {gate.passed ? "通過" : "未通過"}
              </span>
              <span className="text-sm text-slate-600">{displayNextStep(gate.nextStep)}</span>
            </div>
            <div className="mt-5 grid gap-4">
              <GateList title="缺少欄位" items={gate.missingFields} />
              <GateList title="缺少佐證" items={gate.missingEvidence} />
              <GateList title="阻擋原因" items={gate.blockReasons} />
            </div>
          </section>

          <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
            <div className="flex items-center gap-2">
              <FileCheck2 className="h-4 w-4 text-delta-700" />
              <h2 className="text-sm font-semibold text-slate-950">目前狀態</h2>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">佐證</dt>
                <dd className="mt-1 text-slate-900">
                  {displayEvidenceStatus(issue.evidenceStatus)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">等候</dt>
                <dd className="mt-1 text-slate-900">{displayRole(issue.waitingRole)}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">阻擋原因</dt>
                <dd className="mt-1 text-slate-900">{displayBlockReason(issue.blockReason)}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">下一步</dt>
                <dd className="mt-1 text-slate-900">{displayNextStep(issue.nextStep)}</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <div className="flex items-center gap-2">
            <LinkIcon className="h-4 w-4 text-delta-700" />
            <h2 className="text-sm font-semibold text-slate-950">佐證資料</h2>
          </div>
          <div className="mt-4 space-y-3">
            {issue.evidence.length > 0 ? (
              issue.evidence.map((item) => (
                <div key={item.id} className="border-b border-line pb-3 last:border-b-0 last:pb-0">
                  <div className="flex items-center justify-between gap-3">
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-semibold text-delta-700 hover:text-delta-900"
                    >
                      {item.title}
                    </a>
                    <span className="text-xs text-slate-500">{displayOption(item.type)}</span>
                  </div>
                  {item.description ? (
                    <p className="mt-1 text-sm text-slate-600">{item.description}</p>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">尚無佐證資料。</p>
            )}
          </div>
          <form action={evidenceAction} className="mt-5 grid gap-3">
            <ActorInputs role={role} />
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField name="type" label="類型" defaultValue="Link" />
              <TextField name="title" label="標題" required />
            </div>
            <TextField name="url" label="URL" type="url" required />
            <TextAreaField name="description" label="說明" />
            <div className="flex justify-end">
              <button className="h-9 rounded-md bg-delta-700 px-4 text-sm font-semibold text-white hover:bg-delta-800">
                新增佐證
              </button>
            </div>
          </form>
        </section>

        <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-slate-600" />
            <h2 className="text-sm font-semibold text-slate-950">留言</h2>
          </div>
          <div className="mt-4 space-y-3">
            {issue.comments.length > 0 ? (
              issue.comments.map((comment) => (
                <div key={comment.id} className="border-b border-line pb-3 last:border-b-0 last:pb-0">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-slate-900">{comment.authorName}</span>
                    <span className="text-xs text-slate-500">
                      {displayRole(comment.authorRole)} / {formatDateTime(comment.createdAt)}
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{comment.body}</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">尚無留言。</p>
            )}
          </div>
          <form action={commentAction} className="mt-5 grid gap-3">
            <ActorInputs role={role} />
            <TextAreaField name="body" label="留言" required />
            <div className="flex justify-end">
              <button className="h-9 rounded-md bg-delta-700 px-4 text-sm font-semibold text-white hover:bg-delta-800">
                新增留言
              </button>
            </div>
          </form>
        </section>
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-emerald-600" />
            <h2 className="text-sm font-semibold text-slate-950">模擬 AI 助理</h2>
          </div>
          <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            {AI_DISCLAIMER}
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {AI_SUGGESTION_TYPES.map((type) => (
              <form key={type} action={aiAction}>
                <ActorInputs role={role} />
                <input type="hidden" name="suggestionType" value={type} />
                <button className="h-10 w-full rounded-md border border-line bg-white px-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  {displayAiSuggestionType(type)}
                </button>
              </form>
            ))}
          </div>
          <div className="mt-5 space-y-4">
            {issue.aiSuggestions.map((suggestion) => (
              <div key={suggestion.id} className="border-b border-line pb-4 last:border-b-0 last:pb-0">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-slate-900">
                    {displayAiSuggestionType(suggestion.suggestionType)}
                  </span>
                  <span className="text-xs text-slate-500">{formatDateTime(suggestion.createdAt)}</span>
                </div>
                <pre className="mt-2 whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm leading-6 text-slate-700">
                  {suggestion.output}
                </pre>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-slate-600" />
            <h2 className="text-sm font-semibold text-slate-950">稽核紀錄</h2>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-[720px] text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="border-b border-line px-3 py-3">時間</th>
                  <th className="border-b border-line px-3 py-3">動作</th>
                  <th className="border-b border-line px-3 py-3">摘要</th>
                  <th className="border-b border-line px-3 py-3">操作者</th>
                </tr>
              </thead>
              <tbody>
                {issue.auditLogs.map((log) => (
                  <tr key={log.id} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-3 text-slate-600">{formatDateTime(log.createdAt)}</td>
                    <td className="px-3 py-3 font-medium text-slate-900">
                      {displayActionType(log.actionType)}
                    </td>
                    <td className="px-3 py-3 text-slate-700">{log.actionSummary}</td>
                    <td className="px-3 py-3 text-slate-700">
                      {log.actorName}
                      <span className="block text-xs text-slate-400">{displayRole(log.actorRole)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
