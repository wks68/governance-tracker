import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function fieldMap(
  fieldValues: Array<{ fieldKey: string; fieldValue: string }>
): Record<string, string> {
  return fieldValues.reduce<Record<string, string>>((map, field) => {
    map[field.fieldKey] = field.fieldValue;
    return map;
  }, {});
}

export function isFilled(value: string | null | undefined): boolean {
  return Boolean(value && value.trim().length > 0);
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) {
    return "-";
  }

  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "short",
    day: "2-digit"
  }).format(new Date(date));
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) {
    return "-";
  }

  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(date));
}

export function toDateInputValue(date: Date | string | null | undefined): string {
  if (!date) {
    return "";
  }

  return new Date(date).toISOString().slice(0, 10);
}

export function toDateTimeLocalValue(date: Date | string | null | undefined): string {
  if (!date) {
    return "";
  }

  const value = new Date(date);
  value.setMinutes(value.getMinutes() - value.getTimezoneOffset());
  return value.toISOString().slice(0, 16);
}

export function overdueDays(dueDate: Date | string, workflowStatus: string): number {
  if (workflowStatus === "Closed") {
    return 0;
  }

  const due = new Date(dueDate);
  const now = new Date();
  if (due >= now) {
    return 0;
  }

  return Math.max(1, Math.ceil((now.getTime() - due.getTime()) / 86_400_000));
}

export function truncate(value: string, maxLength = 96): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}...`;
}
