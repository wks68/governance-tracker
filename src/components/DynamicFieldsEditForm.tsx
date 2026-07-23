"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { FieldTemplate } from "@/lib/workflow";
import { updateDynamicFieldsAction } from "@/lib/actions";
import DynamicFieldsForm, { DynamicOption } from "@/components/DynamicFieldsForm";

// 讓工單詳情頁可以直接填寫「目前關卡」的動態欄位，不需要跳到編輯頁
export default function DynamicFieldsEditForm({
  issueId,
  template,
  values,
  dynamicOptions,
}: {
  issueId: string;
  template: FieldTemplate[];
  values: Record<string, string>;
  dynamicOptions?: Record<string, DynamicOption[]>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  if (template.length === 0) {
    return <p className="text-sm text-gray-400">此工單類型目前關卡無額外動態欄位。</p>;
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      await updateDynamicFieldsAction(issueId, formData);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <DynamicFieldsForm template={template} values={values} dynamicOptions={dynamicOptions} />
      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? "儲存中..." : "儲存欄位"}
      </button>
    </form>
  );
}
