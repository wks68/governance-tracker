import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/auth";
import { issueTypeLabel } from "@/lib/constants";
import { getVisibleFieldTemplate, getWorkflow, nextStatusOf, prevStatusOf } from "@/lib/workflow";
import { evaluateGateRules } from "@/lib/gateRules";
import StatusBadge from "@/components/StatusBadge";
import WorkflowProgress from "@/components/WorkflowProgress";
import DynamicFieldsEditForm from "@/components/DynamicFieldsEditForm";
import { DynamicOption } from "@/components/DynamicFieldsForm";
import GateCheckPanel from "@/components/GateCheckPanel";
import WorkflowActions from "@/components/WorkflowActions";
import EvidenceList from "@/components/EvidenceList";
import CommentList from "@/components/CommentList";
import AuditLogList from "@/components/AuditLogList";
import AiAssistantPanel from "@/components/AiAssistantPanel";

export const dynamic = "force-dynamic";

export default async function IssueDetailPage({ params }: { params: { id: string } }) {
  await requireCurrentUser();
  const issue = await prisma.issue.findUnique({
    where: { id: params.id },
    include: {
      fieldValues: true,
      evidences: { orderBy: { createdAt: "desc" } },
      comments: { orderBy: { createdAt: "asc" } },
      aiSuggestions: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!issue) notFound();

  const auditLogs = await prisma.auditLog.findMany({
    where: { entityType: "Issue", entityId: issue.id },
    orderBy: { createdAt: "desc" },
    include: { actor: true },
  });

  const fieldsMap: Record<string, string> = {};
  for (const f of issue.fieldValues) fieldsMap[f.fieldKey] = f.fieldValue;
  fieldsMap["__impactProduction"] = issue.impactProduction ? "true" : "false";

  const template = getVisibleFieldTemplate(issue.issueType, issue.workflowStatus);
  const workflow = getWorkflow(issue.issueType);
  const next = nextStatusOf(issue.issueType, issue.workflowStatus);
  const prev = prevStatusOf(issue.issueType, issue.workflowStatus);

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

  const gate = evaluateGateRules({
    issueType: issue.issueType,
    riskLevel: issue.riskLevel,
    currentStatus: issue.workflowStatus,
    targetStatus: next ?? issue.workflowStatus,
    fields: fieldsMap,
    needRca: issue.needRca,
    needRiskException: issue.needRiskException,
    evidenceCount: issue.evidences.length,
    hasClosingComment: issue.comments.length > 0,
  });

  const pulse = issue.statusLight === "Red" && issue.alertLevel === "Critical" && !issue.firstResponseAt;

  return (
    <div className="space-y-6">
      {/* 6.1 Header */}
      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span className="font-mono">{issue.issueKey}</span>
              <span>·</span>
              <span>{issueTypeLabel(issue.issueType)}</span>
            </div>
            <h1 className="mt-1 text-xl font-bold text-gray-900">{issue.title}</h1>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge light={issue.statusLight} pulse={pulse} />
            <Link
              href={`/issues/${issue.id}/edit`}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              編輯
            </Link>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <div className="text-xs text-gray-400">目前流程狀態</div>
            <div className="font-medium text-gray-800">{issue.workflowStatus}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400">負責人</div>
            <div className="font-medium text-gray-800">{issue.ownerName || "—"}（{issue.ownerRole || "—"}）</div>
          </div>
          <div>
            <div className="text-xs text-gray-400">到期日</div>
            <div className="font-medium text-gray-800">{issue.dueDate ? new Date(issue.dueDate).toLocaleDateString("zh-TW") : "—"}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400">等待角色</div>
            <div className="font-medium text-gray-800">{issue.waitingRole || "—"}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* 6.2 基本欄位區 */}
          <section className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">基本欄位</h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-gray-400">系統名稱</dt>
                <dd className="font-medium text-gray-800">{issue.systemName || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">環境</dt>
                <dd className="font-medium text-gray-800">{issue.environment || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">風險等級</dt>
                <dd className="font-medium text-gray-800">{issue.riskLevel || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">優先級</dt>
                <dd className="font-medium text-gray-800">{issue.priority || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">建立人</dt>
                <dd className="font-medium text-gray-800">{issue.reporter || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">是否需 RCA</dt>
                <dd className="font-medium text-gray-800">{issue.needRca ? "是" : "否"}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">是否需風險例外</dt>
                <dd className="font-medium text-gray-800">{issue.needRiskException ? "是" : "否"}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">是否影響正式環境</dt>
                <dd className="font-medium text-gray-800">{issue.impactProduction ? "是" : "否"}</dd>
              </div>
            </dl>
            <div className="mt-3">
              <dt className="text-xs text-gray-400">問題描述</dt>
              <dd className="mt-0.5 whitespace-pre-wrap text-sm text-gray-800">{issue.description || "（尚未填寫問題描述）"}</dd>
            </div>
          </section>

          {/* 6.3 流程進度條 */}
          <section className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">流程進度</h2>
            <WorkflowProgress issueType={issue.issueType} currentStatus={issue.workflowStatus} />
            <div className="mt-4">
              <WorkflowActions
                issueId={issue.id}
                nextStatus={next}
                prevStatus={prev}
                gatePassed={gate.passed}
                canSendBackToRd={
                  issue.issueType === "Hotfix" && ["QA驗證", "QA放行確認"].includes(issue.workflowStatus)
                }
              />
            </div>
          </section>

          {/* 6.5 關卡卡控檢查區 */}
          <section>
            <GateCheckPanel gate={gate} nextStatusLabel={next} />
          </section>

          {/* 6.4 動態欄位區：直接在本頁填寫目前關卡的動態欄位，不需跳轉 */}
          <section id="dynamic-fields-section" className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">
              {issueTypeLabel(issue.issueType)} 專屬欄位（{issue.workflowStatus}）
            </h2>
            <DynamicFieldsEditForm
              issueId={issue.id}
              template={template}
              values={fieldsMap}
              dynamicOptions={dynamicOptions}
            />
          </section>

          {/* 6.6 佐證資料區 */}
          <section className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">佐證資料</h2>
            <EvidenceList
              issueId={issue.id}
              evidences={issue.evidences.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() }))}
            />
          </section>

          {/* 6.7 留言區 */}
          <section className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">留言</h2>
            <CommentList
              issueId={issue.id}
              comments={issue.comments.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() }))}
            />
          </section>

          {/* 6.8 異動紀錄區 */}
          <section className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">異動紀錄</h2>
            <AuditLogList
              logs={auditLogs.map((l) => ({
                id: l.id,
                actionType: l.actionType,
                summary: l.summary,
                actorName: l.actor?.name ?? "系統",
                actorRole: l.actor?.role ?? "",
                createdAt: l.createdAt.toISOString(),
              }))}
            />
          </section>
        </div>

        {/* 6.9 AI 輔助區 */}
        <div className="space-y-6">
          <section className="rounded-lg border border-indigo-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-indigo-700">AI 輔助</h2>
            <AiAssistantPanel
              issueId={issue.id}
              suggestions={issue.aiSuggestions.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() }))}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
