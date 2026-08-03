"use client";

// Hotfix 九階段 UI：附件（選填）——上傳＋清單＋預覽＋刪除共用元件。
// 主管簽核頁傳入 readOnly=true：只能預覽，不顯示上傳／刪除。

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionErrorText } from "@/components/ActionResultBanner";
import { uploadHotfixAttachmentAction, deleteHotfixAttachmentAction } from "@/app/issues/[id]/hotfix/attachment-actions";
import type { HotfixAttachmentView } from "@/lib/hotfix-ui/attachmentService";
import { formatDateTime } from "@/lib/datetime";
import Image from "next/image";

function formatSize(bytes: number | null): string {
  if (bytes === null) return "大小未知";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatAttachmentTime(value: string): string {
  // Node and Chromium can use different Unicode spacing for the same Intl
  // locale. Normalize it so the Client Component hydrates deterministically.
  return formatDateTime(value).replace(/[\u2009\u202f]/g, " ");
}

function isImage(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}
function isPdf(mimeType: string): boolean {
  return mimeType === "application/pdf";
}
function isTextLike(mimeType: string, fileName: string): boolean {
  return mimeType.startsWith("text/") || /\.(log|txt)$/i.test(fileName);
}

function TextPreviewModal({ url, fileName, onClose }: { url: string; fileName: string; onClose: () => void }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useState(() => {
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error("讀取失敗");
        return r.text();
      })
      .then(setContent)
      .catch(() => setError("無法讀取此檔案內容"));
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-800">{fileName}</h3>
          <button type="button" onClick={onClose} className="text-sm text-gray-400 hover:text-gray-600">
            關閉
          </button>
        </div>
        <div className="max-h-[65vh] overflow-auto p-4">
          <ActionErrorText message={error} title="附件預覽失敗" />
          {!error && content === null && <p className="text-sm text-gray-400">載入中…</p>}
          {content !== null && <pre className="whitespace-pre-wrap break-words text-xs text-gray-800">{content}</pre>}
        </div>
      </div>
    </div>
  );
}

function AttachmentItem({ issueId, item, onChanged }: { issueId: string; item: HotfixAttachmentView; onChanged: () => void }) {
  const [textPreviewOpen, setTextPreviewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    if (!confirm(`確定要刪除附件「${item.fileName}」？`)) return;
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("issueId", issueId);
      fd.set("evidenceId", item.id);
      const result = await deleteHotfixAttachmentAction(fd);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onChanged();
    });
  }

  return (
    <div className="animate-item-enter rounded-md border border-gray-200 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-gray-800">{item.fileName}</p>
          <p className="mt-1 text-xs leading-5 text-text-muted">
            {item.mimeType || "未知類型"} ・ {formatSize(item.sizeBytes)} ・ 上傳人：{item.uploaderName} ・ {formatAttachmentTime(item.uploadedAt)}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {isTextLike(item.mimeType, item.fileName) ? (
            <button type="button" onClick={() => setTextPreviewOpen(true)} className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">
              預覽
            </button>
          ) : (
            <a href={item.url} target="_blank" rel="noreferrer" className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">
              {isImage(item.mimeType) || isPdf(item.mimeType) ? "預覽" : "開啟"}
            </a>
          )}
          <a href={`${item.url}?download=1`} className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">
            下載
          </a>
          {item.deletable && (
            <button type="button" disabled={isPending} onClick={handleDelete} className="rounded-md border border-danger-border px-2 py-1 text-xs text-danger-text hover:bg-danger-bg disabled:opacity-40">
              {isPending ? "刪除中…" : "刪除"}
            </button>
          )}
        </div>
      </div>
      {isImage(item.mimeType) && (
        <div className="relative mt-3 aspect-video w-full overflow-hidden rounded-xl border border-border bg-surface-muted">
          <Image src={item.url} alt={item.fileName} fill unoptimized sizes="(min-width: 768px) 50vw, 100vw" className="object-cover object-center" />
        </div>
      )}
      <ActionErrorText message={error} />
      {textPreviewOpen && <TextPreviewModal url={item.url} fileName={item.fileName} onClose={() => setTextPreviewOpen(false)} />}
    </div>
  );
}

export default function AttachmentSection({ issueId, items, readOnly, canUpload }: { issueId: string; items: HotfixAttachmentView[]; readOnly: boolean; canUpload: boolean }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [dragOver, setDragOver] = useState(false);

  function refresh() {
    router.refresh();
  }

  function doUpload(file: File) {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("issueId", issueId);
      fd.set("file", file);
      const result = await uploadHotfixAttachmentAction(fd);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
      refresh();
    });
  }

  return (
    <section id="attachment-section" className="ui-card h-full p-5 sm:p-6">
      <h2 className="text-base font-semibold text-text-primary">附件（選填）</h2>

      {canUpload && !readOnly && (
        <div
          className={`mt-3 rounded-md border-2 border-dashed p-4 text-center text-sm transition-colors duration-150 motion-reduce:transition-none ${dragOver ? "border-primary bg-primary-50" : "border-gray-200"}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) doUpload(file);
          }}
        >
          <p className="text-gray-500">拖放檔案到此處，或</p>
          <button
            type="button"
            disabled={isPending}
            onClick={() => fileInputRef.current?.click()}
            className="mt-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-40"
          >
            {isPending ? "上傳中…" : "上傳附件"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) doUpload(file);
            }}
          />
          <ActionErrorText message={error} />
        </div>
      )}

      <div className="mt-3 space-y-2">
        {items.length === 0 ? (
          <p className="text-sm text-text-muted">尚無附件</p>
        ) : (
          items.map((item) => <AttachmentItem key={item.id} issueId={issueId} item={item} onChanged={refresh} />)
        )}
      </div>
    </section>
  );
}
