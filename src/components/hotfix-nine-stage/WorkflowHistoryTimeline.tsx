import ExpandableContentBlock from "@/components/ui/ExpandableContentBlock";
import RichTextViewer from "@/components/rich-text/RichTextViewer";

export interface WorkflowHistoryEntry {
  id: string;
  primary: string;
  meta: string;
  detail?: string | null;
  richDetails?: Array<{ label: string; value: string }>;
  fieldChanges?: Array<{ label: string; before: string; after: string }>;
  technicalCode?: string | null;
}

export default function WorkflowHistoryTimeline({ entries }: { entries: WorkflowHistoryEntry[] }) {
  return (
    <section className="ui-card p-5 sm:p-6" aria-labelledby="workflow-history-title">
      <h2 id="workflow-history-title" className="text-base font-semibold text-text-primary">簽核紀錄歷程</h2>
      {entries.length === 0 ? (
        <p className="mt-3 text-sm text-text-muted">尚無簽核或流程紀錄</p>
      ) : (
        <ol className="mt-5 min-w-0 max-w-full space-y-4">
          {entries.map((entry) => (
            <li key={entry.id} className="relative min-w-0 max-w-full border-l-2 border-border pb-1 pl-5 [overflow-wrap:anywhere]">
              <span aria-hidden className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-primary" />
              <div className="min-w-0 max-w-full text-sm leading-6"><ExpandableContentBlock text={entry.primary} characterThreshold={220} /></div>
              <p className="mt-1 break-words text-sm leading-5 text-text-muted">{entry.meta}</p>
              {entry.technicalCode && <p className="mt-0.5 break-all font-mono text-xs leading-5 text-text-muted">事件代碼：{entry.technicalCode}</p>}
              {entry.detail && <div className="mt-2 min-w-0 max-w-full rounded-lg bg-surface-muted px-3 py-2 text-sm leading-6"><ExpandableContentBlock text={entry.detail} characterThreshold={180} /></div>}
              {entry.fieldChanges?.map((change, index) => (
                <section key={`${change.label}-${index}`} className="mt-2 min-w-0 max-w-full rounded-lg border border-border bg-surface-muted p-3" aria-label={`${change.label}異動`}>
                  <h3 className="break-words text-sm font-semibold leading-6 text-text-primary">{change.label}</h3>
                  <div className="mt-2 grid min-w-0 max-w-full grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="min-w-0 rounded-md bg-white p-3"><p className="text-xs font-medium text-text-muted">Before</p><div className="mt-1"><ExpandableContentBlock text={change.before} characterThreshold={180} /></div></div>
                    <div className="min-w-0 rounded-md bg-white p-3"><p className="text-xs font-medium text-text-muted">After</p><div className="mt-1"><ExpandableContentBlock text={change.after} characterThreshold={180} /></div></div>
                  </div>
                </section>
              ))}
              {entry.richDetails?.map((detail) => <div key={detail.label} className="mt-2 min-w-0 max-w-full rounded-lg bg-surface-muted px-3 py-2"><p className="mb-1 break-words text-sm font-medium leading-5 text-text-secondary">{detail.label}</p><RichTextViewer value={detail.value} /></div>)}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
