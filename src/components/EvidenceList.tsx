"use client";

import { useRef, useTransition } from "react";
import { EVIDENCE_TYPES } from "@/lib/constants";
import { addEvidenceAction } from "@/lib/actions";

interface EvidenceItem {
  id: string;
  type: string;
  title: string;
  url: string;
  description: string;
  createdAt: string;
}

export default function EvidenceList({ issueId, evidences }: { issueId: string; evidences: EvidenceItem[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      await addEvidenceAction(issueId, fd);
      formRef.current?.reset();
    });
  }

  return (
    <div className="space-y-4">
      {evidences.length === 0 ? (
        <p className="text-sm text-gray-400">尚無佐證資料。</p>
      ) : (
        <ul className="space-y-2">
          {evidences.map((ev) => (
            <li key={ev.id} className="rounded-md border border-gray-200 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{ev.type}</span>
                <span className="text-xs text-gray-400">{new Date(ev.createdAt).toLocaleString("zh-TW")}</span>
              </div>
              <a href={ev.url} target="_blank" rel="noreferrer" className="mt-1 block font-medium text-primary hover:underline">
                {ev.title}
              </a>
              {ev.description && <p className="mt-1 text-gray-600">{ev.description}</p>}
            </li>
          ))}
        </ul>
      )}

      <form ref={formRef} onSubmit={onSubmit} className="space-y-2 rounded-md border border-dashed border-gray-300 p-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <select name="type" className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" defaultValue={EVIDENCE_TYPES[0]}>
            {EVIDENCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input name="title" required placeholder="佐證標題" className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
        </div>
        <input name="url" required placeholder="佐證 URL" className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
        <textarea name="description" placeholder="說明（選填）" rows={2} className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
        >
          新增佐證資料
        </button>
      </form>
    </div>
  );
}
