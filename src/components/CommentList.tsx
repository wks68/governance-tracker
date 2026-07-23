"use client";

import { useRef, useTransition } from "react";
import { addCommentAction } from "@/lib/actions";

interface CommentItem {
  id: string;
  authorRole: string;
  authorName: string;
  body: string;
  createdAt: string;
}

export default function CommentList({ issueId, comments }: { issueId: string; comments: CommentItem[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      await addCommentAction(issueId, fd);
      formRef.current?.reset();
    });
  }

  return (
    <div className="space-y-4">
      {comments.length === 0 ? (
        <p className="text-sm text-gray-400">尚無留言。</p>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="rounded-md bg-gray-50 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium text-gray-800">
                  {c.authorName}
                  <span className="ml-1 rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-600">{c.authorRole}</span>
                </span>
                <span className="text-xs text-gray-400">{new Date(c.createdAt).toLocaleString("zh-TW")}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-gray-700">{c.body}</p>
            </li>
          ))}
        </ul>
      )}

      <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-2">
        <textarea
          name="body"
          required
          rows={2}
          placeholder="輸入留言內容..."
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
        />
        <button
          type="submit"
          disabled={isPending}
          className="self-start rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
        >
          送出留言
        </button>
      </form>
    </div>
  );
}
