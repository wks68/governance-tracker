import { AlertTriangle, CircleAlert, Inbox, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";

function StateFrame({ icon, title, description, action }: { icon: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="ui-card flex flex-col items-center px-5 py-9 text-center">
      <div className="mb-3 rounded-full bg-surface-muted p-3 text-text-muted">{icon}</div>
      <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
      {description && <p className="mt-1 max-w-lg text-sm text-text-secondary">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function EmptyState(props: { title: string; description?: string; action?: ReactNode }) {
  return <StateFrame icon={<Inbox className="h-5 w-5" aria-hidden />} {...props} />;
}

export function LoadingState({ title = "載入中…" }: { title?: string }) {
  return <StateFrame icon={<LoaderCircle className="h-5 w-5 animate-spin" aria-hidden />} title={title} />;
}

export function ErrorState(props: { title: string; description?: string; action?: ReactNode }) {
  return <StateFrame icon={<CircleAlert className="h-5 w-5 text-danger" aria-hidden />} {...props} />;
}

export function WarningState(props: { title: string; description?: string; action?: ReactNode }) {
  return <StateFrame icon={<AlertTriangle className="h-5 w-5 text-warning" aria-hidden />} {...props} />;
}
