// Hotfix 九階段 UI：共用「工單基本資訊」唯讀區塊，9 個頁面皆須顯示且欄位一致。
// 依需求明確排除：責任人（owner）／是否需 RCA／是否為風險例外／是否影響正式環境。

import ExpandableContentBlock from "@/components/ui/ExpandableContentBlock";
import Tooltip from "@/components/ui/Tooltip";
import { hotfixPriorityDefOf } from "@/lib/hotfix-ui/priority";
import { HOTFIX_URGENCY_GOVERNANCE } from "@/lib/hotfix-ui/priority";
import RichTextViewer from "@/components/rich-text/RichTextViewer";

const ARROW_GLYPH: Record<string, string> = {
  "up-double": "▲▲",
  up: "▲",
  down: "▼",
  "down-double": "▼▼",
};

export interface TicketBasicInfoData {
  issueKey: string;
  reporterName: string;
  teamName: string | null;
  environment: string;
  title: string;
  description: string;
  systemName: string;
  riskLevel: string;
  hotfixPriority: string | null;
  dueDate: string | null; // ISO date or null
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-gray-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-gray-800">{children}</dd>
    </div>
  );
}

export default function TicketBasicInfo({ data }: { data: TicketBasicInfoData }) {
  const priorityDef = hotfixPriorityDefOf(data.hotfixPriority);
  return (
    <section className="ui-card h-full p-5 sm:p-6">
      <h2 className="text-base font-semibold text-text-primary">Hotfix 單基本資訊</h2>
      <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Hotfix 單編號">{data.issueKey}</Field>
        <Field label="申請人">{data.reporterName || "尚未提供"}</Field>
        <Field label="團隊名稱">{data.teamName || "尚待承接"}</Field>
        <Field label="環境">{data.environment || "尚未提供"}</Field>
        <Field label="系統名稱">{data.systemName || "尚未提供"}</Field>
        <Field label="風險等級">{data.riskLevel || "尚未提供"}</Field>
        <Field label={<span className="inline-flex items-center gap-1.5">緊急程度<Tooltip label="緊急程度說明" content={HOTFIX_URGENCY_GOVERNANCE} /></span>}>
          {priorityDef ? (
            <span className={`inline-flex items-center gap-1 font-medium ${priorityDef.colorClass}`}>
              <span aria-hidden>{ARROW_GLYPH[priorityDef.arrow]}</span>
              {priorityDef.label}
            </span>
          ) : (
            "尚未提供"
          )}
        </Field>
        <Field label="預計完成日">{data.dueDate ? data.dueDate.slice(0, 10) : "尚未設定"}</Field>
      </dl>
      <div className="mt-5 border-t border-border pt-4">
        <dt className="text-xs font-medium text-text-muted">Hotfix 標題</dt>
        <dd className="mt-1 font-medium"><ExpandableContentBlock text={data.title} emptyText="尚未命名" characterThreshold={180} /></dd>
      </div>
      <div className="mt-4">
        <dt className="text-xs font-medium text-text-muted">Hotfix 問題描述</dt>
        <dd className="mt-1">
          <RichTextViewer value={data.description} empty="尚未提供" />
        </dd>
      </div>
    </section>
  );
}
