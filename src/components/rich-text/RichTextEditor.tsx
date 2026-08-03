"use client";

import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent, ReactNodeViewRenderer } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import FontFamily from "@tiptap/extension-font-family";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { Extension } from "@tiptap/core";
import { Bold, Italic, UnderlineIcon, Strikethrough, List, ListOrdered, ImagePlus, Undo2, Redo2, RemoveFormatting, Loader2, Trash2 } from "lucide-react";
import { uploadHotfixRichTextImageAction } from "@/app/issues/[id]/hotfix/attachment-actions";
import { parseRichTextValue, serializeRichTextValue, RICH_TEXT_COLORS, RICH_TEXT_FONT_SIZES, RICH_TEXT_FONTS } from "@/lib/rich-text/value";
import ResizableImageNodeView from "./ResizableImageNodeView";

declare module "@tiptap/core" { interface Commands<ReturnType> { fontSize: { setFontSize: (size: string) => ReturnType; unsetFontSize: () => ReturnType } } }

const FontSize = Extension.create({
  name: "fontSize",
  addGlobalAttributes() {
    return [{
      types: ["textStyle"],
      attributes: {
        fontSize: {
          default: null,
          parseHTML: (element) => element.style.fontSize || null,
          renderHTML: (attributes) => attributes.fontSize ? { style: `font-size: ${attributes.fontSize}` } : {},
        },
      },
    }];
  },
  addCommands() { return { setFontSize: (fontSize) => ({ chain }) => chain().setMark("textStyle", { fontSize }).run(), unsetFontSize: () => ({ chain }) => chain().setMark("textStyle", { fontSize: null }).removeEmptyTextStyle().run() }; },
});

const ManagedImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      pendingId: { default: null, renderHTML: () => ({}) },
      widthPercent: {
        default: 100,
        parseHTML: (element) => Number(element.getAttribute("data-width-percent")) || 100,
        renderHTML: (attributes) => ({ "data-width-percent": attributes.widthPercent }),
      },
    };
  },
  addNodeView() { return ReactNodeViewRenderer(ResizableImageNodeView); },
  addKeyboardShortcuts() {
    return {
      Escape: () => {
        if (!this.editor.isActive("image")) return false;
        return this.editor.commands.setTextSelection(this.editor.state.selection.to);
      },
    };
  },
});

const colorOptions = [
  ["預設", "#1F2937"], ["深灰", "#475569"], ["紅", "#B91C1C"], ["橘", "#C2410C"],
  ["黃褐", "#8A6116"], ["綠", "#15803D"], ["藍", "#1D4ED8"], ["紫", "#6D28D9"],
] as const;
const fontOptions = [["系統預設", "inherit"], ["微軟正黑體", '"Microsoft JhengHei", sans-serif'], ["Noto Sans TC", '"Noto Sans TC", sans-serif'], ["Arial", "Arial, sans-serif"], ["sans-serif", "sans-serif"]] as const;
const sizeOptions = [["小", "12px"], ["一般", "14px"], ["中", "16px"], ["大", "18px"], ["特大", "24px"]] as const;

interface PendingImage { id: string; file: File; objectUrl: string }

export default function RichTextEditor({
  name,
  value = "",
  onChange,
  issueId,
  required = false,
  disabled = false,
  placeholder = "請輸入內容",
  minHeight = 180,
  ariaDescribedBy,
  onBusyChange,
}: {
  name: string; value?: string; onChange?: (value: string) => void; issueId?: string; required?: boolean; disabled?: boolean;
  placeholder?: string; minHeight?: number; ariaDescribedBy?: string; onBusyChange?: (busy: boolean) => void;
}) {
  const [serialized, setSerialized] = useState(() => JSON.stringify(parseRichTextValue(value)));
  const [pending, setPending] = useState<PendingImage[]>([]);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef<PendingImage[]>([]);
  const busyCallbackRef = useRef(onBusyChange);
  pendingRef.current = pending;
  busyCallbackRef.current = onBusyChange;

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, Underline, TextStyle, Color.configure({ types: ["textStyle"] }), FontFamily.configure({ types: ["textStyle"] }), FontSize, ManagedImage.configure({ inline: false, allowBase64: false }), Placeholder.configure({ placeholder })],
    content: parseRichTextValue(value).doc,
    editable: !disabled,
    editorProps: {
      attributes: { class: "rich-text-content min-w-0 px-4 py-3 text-sm text-text-primary outline-none" },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"));
        if (!files.length) return false;
        event.preventDefault();
        void addImages(files);
        return true;
      },
    },
    onUpdate: ({ editor: current }) => publish(current.getJSON()),
  });

  useEffect(() => { editor?.setEditable(!disabled); }, [disabled, editor]);
  useEffect(() => {
    if (!editor) return;
    const nextDoc = parseRichTextValue(value, { allowPending: !issueId }).doc;
    const next = serializeRichTextValue(nextDoc, { allowPending: !issueId });
    const current = serializeRichTextValue(editor.getJSON(), { allowPending: !issueId });
    if (next !== current) editor.commands.setContent(nextDoc, false);
  }, [editor, issueId, value]);
  useEffect(() => { busyCallbackRef.current?.(uploading > 0); }, [uploading]);
  useEffect(() => () => { for (const item of pendingRef.current) URL.revokeObjectURL(item.objectUrl); }, []);

  function publish(doc: unknown) {
    try {
      const next = serializeRichTextValue(doc, { allowPending: !issueId });
      setSerialized(next);
      onChange?.(next);
    } catch { /* Invalid transient nodes never leave the editor. */ }
  }

  async function addImages(files: File[]) {
    if (!editor || disabled) return;
    setError(null);
    for (const file of files) {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) { setError("圖片格式不支援，請使用 PNG、JPEG 或 WebP"); continue; }
      if (file.size > 20 * 1024 * 1024) { setError("圖片超過大小限制（20MB）"); continue; }
      if (issueId) {
        setUploading((count) => count + 1);
        const data = new FormData(); data.set("issueId", issueId); data.set("file", file);
        const result = await uploadHotfixRichTextImageAction(data);
        setUploading((count) => count - 1);
        if (!result.ok || !result.data) { setError(result.ok ? "圖片上傳失敗，請重試" : result.message); continue; }
        editor.chain().focus().setImage({ src: result.data.url, alt: "使用者上傳的問題截圖", widthPercent: 100 } as never).run();
      } else {
        const id = crypto.randomUUID();
        const objectUrl = URL.createObjectURL(file);
        setPending((items) => [...items, { id, file, objectUrl }]);
        editor.chain().focus().setImage({ src: objectUrl, alt: "使用者上傳的問題截圖", pendingId: id, widthPercent: 100 } as never).run();
      }
    }
  }

  function removePending(id: string) {
    const item = pending.find((entry) => entry.id === id);
    if (item) URL.revokeObjectURL(item.objectUrl);
    setPending((items) => items.filter((entry) => entry.id !== id));
    if (editor) {
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "image" && node.attrs.pendingId === id) editor.commands.deleteRange({ from: pos, to: pos + node.nodeSize });
      });
    }
  }

  const toolbarButton = "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-transparent text-text-secondary hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40 aria-pressed:bg-primary-muted aria-pressed:text-primary";
  const tools = [
    ["復原", Undo2, () => editor?.chain().focus().undo().run(), false], ["重做", Redo2, () => editor?.chain().focus().redo().run(), false],
    ["粗體", Bold, () => editor?.chain().focus().toggleBold().run(), editor?.isActive("bold")], ["斜體", Italic, () => editor?.chain().focus().toggleItalic().run(), editor?.isActive("italic")],
    ["底線", UnderlineIcon, () => editor?.chain().focus().toggleUnderline().run(), editor?.isActive("underline")], ["刪除線", Strikethrough, () => editor?.chain().focus().toggleStrike().run(), editor?.isActive("strike")],
    ["項目符號清單", List, () => editor?.chain().focus().toggleBulletList().run(), editor?.isActive("bulletList")], ["編號清單", ListOrdered, () => editor?.chain().focus().toggleOrderedList().run(), editor?.isActive("orderedList")],
  ] as const;

  return (
    <div className="min-w-0 max-w-full overflow-hidden">
      <div className="max-w-full overflow-hidden rounded-lg border border-input-border bg-white focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
        <div className="flex min-h-11 min-w-0 max-w-full flex-wrap items-center gap-1 overflow-hidden border-b border-border bg-surface-muted p-1" role="toolbar" aria-label="富文字格式工具列">
          {tools.map(([label, Icon, action, active]) => <button key={label} type="button" title={label} aria-label={label} aria-pressed={!!active} disabled={disabled} className={toolbarButton} onClick={action}><Icon className="h-4 w-4" /></button>)}
          <select aria-label="字型" title="字型" disabled={disabled} className="h-9 w-[118px] min-w-0 max-w-full rounded-md border border-input-border bg-white px-2 text-xs" value={(editor?.getAttributes("textStyle").fontFamily as string) || "inherit"} onChange={(e) => e.target.value === "inherit" ? editor?.chain().focus().unsetFontFamily().run() : editor?.chain().focus().setFontFamily(e.target.value).run()}>{fontOptions.filter(([, v]) => (RICH_TEXT_FONTS as readonly string[]).includes(v)).map(([l, v]) => <option value={v} key={v}>{l}</option>)}</select>
          <select aria-label="字型大小" title="字型大小" disabled={disabled} className="h-9 w-[72px] min-w-0 rounded-md border border-input-border bg-white px-2 text-xs" value={(editor?.getAttributes("textStyle").fontSize as string) || "14px"} onChange={(e) => editor?.chain().focus().setFontSize(e.target.value).run()}>{sizeOptions.filter(([, v]) => (RICH_TEXT_FONT_SIZES as readonly string[]).includes(v)).map(([l, v]) => <option value={v} key={v}>{l}</option>)}</select>
          <select aria-label="文字顏色" title="文字顏色" disabled={disabled} className="h-9 w-[72px] min-w-0 rounded-md border border-input-border bg-white px-2 text-xs" value={(editor?.getAttributes("textStyle").color as string) || "#1F2937"} onChange={(e) => editor?.chain().focus().setColor(e.target.value).run()}>{colorOptions.filter(([, v]) => (RICH_TEXT_COLORS as readonly string[]).includes(v)).map(([l, v]) => <option value={v} key={v}>{l}</option>)}</select>
          <button type="button" title="插入圖片" aria-label="插入圖片" disabled={disabled || uploading > 0} className={toolbarButton} onClick={() => fileInputRef.current?.click()}>{uploading ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <ImagePlus className="h-4 w-4" />}</button>
          <button type="button" title="清除格式" aria-label="清除格式" disabled={disabled} className={toolbarButton} onClick={() => editor?.chain().focus().unsetAllMarks().clearNodes().run()}><RemoveFormatting className="h-4 w-4" /></button>
          <input ref={fileInputRef} type="file" className="sr-only" accept="image/png,image/jpeg,image/webp" multiple onChange={(e) => { void addImages(Array.from(e.target.files ?? [])); e.currentTarget.value = ""; }} />
        </div>
        <div style={{ minHeight }} aria-describedby={ariaDescribedBy} aria-busy={uploading > 0}><EditorContent editor={editor} /></div>
      </div>
      <input type="hidden" name={name} value={serialized} required={required} />
      {pending.map((item) => <div key={item.id} className="mt-2 flex items-center justify-between gap-2 rounded-md border border-border bg-surface-muted px-3 py-2 text-xs"><span className="min-w-0 truncate">待送出圖片：{item.file.name}</span><button type="button" className="inline-flex min-h-9 items-center gap-1 text-danger-text" aria-label={`移除圖片 ${item.file.name}`} onClick={() => removePending(item.id)}><Trash2 className="h-4 w-4" />移除</button><PendingFileInput name={`richTextImage:${item.id}`} file={item.file} /></div>)}
      {uploading > 0 && <p className="mt-1 text-xs text-text-secondary" aria-live="polite">圖片上傳中，完成前無法提交。</p>}
      {error && <p className="mt-1 text-xs text-danger-text" role="alert">{error}</p>}
    </div>
  );
}

function PendingFileInput({ name, file }: { name: string; file: File }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!ref.current) return; const transfer = new DataTransfer(); transfer.items.add(file); ref.current.files = transfer.files; }, [file]);
  return <input ref={ref} type="file" name={name} className="sr-only" tabIndex={-1} aria-hidden />;
}
