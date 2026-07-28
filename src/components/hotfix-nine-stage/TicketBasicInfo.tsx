// Hotfix 九階段 UI：共用「工單基本資訊」唯讀區塊，9 個頁面皆須顯示且欄位一致。
// 依需求明確排除：責任人（owner）／是否需 RCA／是否為風險例外／是否影響正式環境。

import ExpandableText from "./ExpandableText";
import { hotfixPriorityDefOf } from "@/lib/hotfix-ui/priority";

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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
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
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-800">工單基本資訊</h2>
      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="工單編號">{data.issueKey}</Field>
        <Field label="申請人">{data.reporterName || "（未指定）"}</Field>
        <Field label="團隊名稱">{data.teamName || "（未指定）"}</Field>
        <Field label="環境">{data.environment || "（未填寫）"}</Field>
        <Field label="系統名稱">{data.systemName || "（未填寫）"}</Field>
        <Field label="風險等級">{data.riskLevel || "（未填寫）"}</Field>
        <Field label="Hotfix 工單優先級">
          {priorityDef ? (
            <span className={`inline-flex items-center gap-1 font-medium ${priorityDef.colorClass}`}>
              <span aria-hidden>{ARROW_GLYPH[priorityDef.arrow]}</span>
              {priorityDef.label}
            </span>
          ) : (
            "（未填寫）"
          )}
        </Field>
        <Field label="預計完成日">{data.dueDate ? data.dueDate.slice(0, 10) : "（未填寫）"}</Field>
      </dl>
      <div className="mt-4 border-t border-gray-100 pt-3">
        <dt className="text-xs text-gray-400">標題</dt>
        <dd className="mt-0.5 text-sm font-medium text-gray-900">{data.title || "（未命名）"}</dd>
      </div>
      <div className="mt-3">
        <dt className="text-xs text-gray-400">問題現象</dt>
        <dd className="mt-0.5">
          <ExpandableText text={data.description} />
        </dd>
      </div>
    </section>
  );
}
