import clsx from "clsx";
import type { ReactNode } from "react";

export function FormSection({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx("ui-card p-4 sm:p-5", className)}>
      <div className="mb-4">
        <h2 className="text-base font-semibold text-text-primary">{title}</h2>
        {description && <p className="mt-1 text-sm text-text-secondary">{description}</p>}
      </div>
      {children}
    </section>
  );
}

export function FormField({
  label,
  required = false,
  help,
  error,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  help?: string;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="mb-1 flex items-center gap-1 text-sm font-medium text-text-secondary">
        <span>{label}</span>
        {required && <span className="text-danger" aria-label="必填">*</span>}
      </div>
      {children}
      {help && !error && <p className="mt-1 text-xs leading-5 text-text-muted">{help}</p>}
      {error && <p className="mt-1 text-xs font-medium text-danger" role="alert">{error}</p>}
    </div>
  );
}

export function ReadOnlyField({
  label,
  value,
  description,
}: {
  label: string;
  value: string;
  description?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-muted px-3 py-2.5">
      <dt className="text-xs font-medium text-text-muted">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-text-primary">{value}</dd>
      {description && <dd className="mt-1 text-xs text-text-secondary">{description}</dd>}
    </div>
  );
}
