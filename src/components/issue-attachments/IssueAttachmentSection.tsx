"use client";

// Incident／RCA 共用附件區塊：拖曳／點擊上傳／貼上截圖、圖片預覽、非圖片 fallback 圖示、
// 檔名／大小顯示、可刪除時顯示移除按鈕。比照任務規格第十二節，重用同一組
// issue-attachments/service.ts＋既有下載路由，不建立第二套元件邏輯。

import { useRef, useState, useTransition } from "react";
import { Paperclip, FileText, X, UploadCloud } from "lucide-react";
import { uploadIssueAttachmentAction, deleteIssueAttachmentAction } from "@/lib/issue-attachments/actions";
import { ActionErrorText } from "@/components/ActionResultBanner";

export interface IssueAttachmentItem {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number | null;
  uploaderName: string;
  uploadedAt: string;
  url: string;
  deletable: boolean;
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function IssueAttachmentSection({
  issueId,
  actionItemId,
  items,
  canUpload,
  title = "附件",
  helperText = "有畫面截圖可協助加快處理，沒有也可以先送出。",
}: {
  issueId: string;
  actionItemId?: string;
  items: IssueAttachmentItem[];
  canUpload: boolean;
  title?: string;
  helperText?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function doUpload(file: File) {
    setError(null);
    const formData = new FormData();
    formData.set("issueId", issueId);
    if (actionItemId) formData.set("actionItemId", actionItemId);
    formData.set("file", file);
    startTransition(async () => {
      const result = await uploadIssueAttachmentAction(formData);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      window.location.reload();
    });
  }

  function doDelete(evidenceId: string) {
    setError(null);
    const formData = new FormData();
    formData.set("issueId", issueId);
    formData.set("evidenceId", evidenceId);
    startTransition(async () => {
      const result = await deleteIssueAttachmentAction(formData);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      window.location.reload();
    });
  }

  function handleFiles(fileList: FileList | null) {
    const file = fileList?.[0];
    if (file) doUpload(file);
  }

  function handlePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    if (!canUpload) return;
    const file = Array.from(event.clipboardData.items)
      .find((item) => item.kind === "file")
      ?.getAsFile();
    if (file) {
      event.preventDefault();
      doUpload(file);
    }
  }

  return (
    <section id={actionItemId ? `attachment-section-${actionItemId}` : "attachment-section"} className="ui-card p-5 sm:p-6">
      <h2 className="flex items-center gap-2 text-base font-semibold text-text-primary">
        <Paperclip className="h-4 w-4" aria-hidden />
        {title}
      </h2>
      <ActionErrorText message={error} code={null} itemKey={issueId} />

      {canUpload && (
        <div
          className={`mt-3 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center text-sm transition-colors ${dragOver ? "border-primary bg-primary-muted" : "border-border"}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
          onPaste={handlePaste}
          tabIndex={0}
          aria-label="上傳附件，可拖曳、點擊選擇或貼上截圖"
        >
          <UploadCloud className="h-6 w-6 text-text-muted" aria-hidden />
          <p className="text-text-secondary">拖曳檔案到這裡、點擊選擇，或直接貼上截圖</p>
          <button
            type="button"
            disabled={isPending}
            onClick={() => fileInputRef.current?.click()}
            className="ui-button-secondary min-h-11"
          >
            {isPending ? "上傳中…" : "選擇檔案"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="sr-only"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <p className="text-xs text-text-muted">{helperText}</p>
        </div>
      )}

      {items.length === 0 ? (
        <p className="mt-3 text-sm text-text-muted">{canUpload ? "尚未上傳任何附件。" : "目前沒有附件。"}</p>
      ) : (
        <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 rounded-md border border-border p-3">
              {item.mimeType.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.url} alt={item.fileName} className="h-14 w-14 shrink-0 rounded object-cover" />
              ) : (
                <FileText className="h-10 w-10 shrink-0 text-text-muted" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <a href={`${item.url}?download=1`} className="block truncate text-sm font-medium text-primary hover:underline" title={item.fileName}>
                  {item.fileName}
                </a>
                <p className="mt-0.5 text-xs text-text-muted">{formatSize(item.sizeBytes)} · {item.uploaderName}</p>
              </div>
              {item.deletable && (
                <button
                  type="button"
                  aria-label={`移除附件 ${item.fileName}`}
                  disabled={isPending}
                  onClick={() => doDelete(item.id)}
                  className="min-h-11 min-w-11 rounded-md p-2 text-text-muted hover:bg-danger-muted hover:text-danger-text"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
