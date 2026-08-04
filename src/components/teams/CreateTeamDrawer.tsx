"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Drawer from "@/components/Drawer";
import { ActionErrorText } from "@/components/ActionResultBanner";
import { createTeamAction } from "@/app/admin/teams/actions";

export default function CreateTeamDrawer() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const fd = new FormData();
    fd.set("name", name);
    fd.set("description", description);
    startTransition(async () => {
      const result = await createTeamAction(fd);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setOpen(false);
      setName("");
      setDescription("");
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover"
      >
        ＋ 建立團隊
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title="建立團隊" isSubmitting={isPending}>
        <form onSubmit={submit} className="space-y-3">
          <ActionErrorText message={error} />
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">團隊名稱</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              disabled={isPending}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:bg-gray-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">說明</label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isPending}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:bg-gray-100"
            />
          </div>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "建立中…" : "建立"}
          </button>
        </form>
      </Drawer>
    </>
  );
}
