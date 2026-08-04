"use client";

import Link from "next/link";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import type { HotfixListActionView } from "@/lib/hotfix-list/viewModel";

const VARIANT_CLASS: Record<HotfixListActionView["variant"], string> = {
  "pending-approval": "bg-action-pending-approval text-action-pending-approval-foreground shadow-sm hover:bg-action-pending-approval-hover active:bg-action-pending-approval-active focus-visible:ring-2 focus-visible:ring-action-pending-approval-focus focus-visible:ring-offset-2",
  "pending-work": "bg-action-pending-work text-action-pending-work-foreground shadow-sm hover:bg-action-pending-work-hover active:bg-action-pending-work-active focus-visible:ring-2 focus-visible:ring-action-pending-work-focus focus-visible:ring-offset-2",
  view: "border border-action-view-border bg-action-view text-action-view-foreground hover:border-action-view-border-hover hover:bg-action-view-hover active:bg-action-view-active focus-visible:ring-2 focus-visible:ring-action-view-focus focus-visible:ring-offset-2",
};

export default function IssueActionButton({ action, fullWidth = false }: { action: HotfixListActionView; fullWidth?: boolean }) {
  const [pending, setPending] = useState(false);
  return (
    <Link
      href={action.href}
      aria-disabled={pending}
      onClick={(event) => {
        if (pending) event.preventDefault();
        else setPending(true);
      }}
      className={`issue-action-button ${VARIANT_CLASS[action.variant]} ${fullWidth ? "h-11 w-full min-w-full max-w-full" : ""} ${pending ? "pointer-events-none" : ""}`}
    >
      {pending && <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />}
      <span>{action.label}</span>
    </Link>
  );
}
