"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionErrorText } from "@/components/ActionResultBanner";
import { advanceHotfixOpDeploymentAction } from "../execution-actions";

export default function OpCompletedContinueButton({ issueId }: { issueId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("issueId", issueId);
      const result = await advanceHotfixOpDeploymentAction(fd);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <ActionErrorText message={error} />
      <button
        type="button"
        disabled={isPending}
        onClick={handleClick}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-40"
      >
        {isPending ? "處理中…" : "開放結案確認"}
      </button>
    </section>
  );
}
