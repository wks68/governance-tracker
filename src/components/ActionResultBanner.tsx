"use client";

import { useEffect } from "react";
import { useActionErrorToast } from "@/components/toast/AppToastProvider";

// 保留既有呼叫介面，將全域 action 錯誤集中送到唯一的 AppToastProvider。
// fieldErrors 仍由各表單的 FormPrimitives 在欄位旁顯示，不經過此元件。
export function ActionErrorText({
  message,
  code,
  itemKey,
  title,
}: {
  message: string | null;
  code?: string | null;
  itemKey?: string;
  title?: string;
}) {
  const { notifyActionError } = useActionErrorToast();

  useEffect(() => {
    if (message) notifyActionError({ message, code, itemKey, title });
  }, [code, itemKey, message, notifyActionError, title]);

  return null;
}

export function ActionSuccessText({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="mb-3 rounded-md border border-success-border bg-success-bg px-3 py-2 text-xs text-success-text">{message}</p>;
}
