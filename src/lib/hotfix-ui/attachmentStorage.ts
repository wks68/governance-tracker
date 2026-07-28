// Hotfix 九階段 UI：附件（選填）實際位元組的本地磁碟儲存層。
//
// 背景（本輪不得新增 Schema／Migration 的限制下的折衷方案）：既有 Evidence model 只有
// url／type／title／description，沒有檔案位元組欄位，也沒有 fileSize／mimeType／
// uploadedByUserId／stageKey 專屬欄位。本檔案讓「真正上傳的檔案位元組」寫入本地磁碟
// （worktree 內、.gitignore 排除、不進版控、不寫入正式 dev.db），Evidence row 只存中繼資料：
//   url         = 內部下載／預覽路徑 "/api/hotfix-attachments/{evidenceId}"（不是外部連結）
//   title       = 使用者上傳時的原始檔名（僅供顯示，不得用於組路徑，防路徑穿越）
//   type        = MIME type（例如 "image/png"）
//   description = JSON.stringify({ stageKey, uploaderUserId, uploaderName })
// 檔案大小一律即時以 fs.stat 讀取磁碟檔案取得，不額外存欄位，避免 DB 與磁碟不同步。
//
// 判斷「這筆 Evidence 是不是 Hotfix 附件」的唯一依據：url 是否以
// ATTACHMENT_URL_PREFIX 開頭——這樣才能與既有（EvidenceList.tsx 既有的）外部連結型
// 佐證資料共用同一張表而互不干擾、互不誤判。

import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

export const ATTACHMENT_URL_PREFIX = "/api/hotfix-attachments/";

const STORAGE_ROOT = path.join(process.cwd(), "storage", "hotfix-attachments");

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20MB，避免本地磁碟被單一 Issue 塞爆

async function ensureStorageRoot(): Promise<void> {
  await fs.mkdir(STORAGE_ROOT, { recursive: true });
}

// storedFileName 一律是伺服器產生的隨機 UUID，與使用者上傳的原始檔名完全無關，
// 杜絕路徑穿越（../）與檔名注入風險；原始檔名只存在 Evidence.title 供顯示。
function storedFilePath(storedFileName: string): string {
  // storedFileName 必為 randomUUID() 產生，防禦性再次過濾，拒絕任何非 UUID 格式的輸入。
  if (!/^[0-9a-f-]{36}$/.test(storedFileName)) {
    throw new Error("非法的附件檔案代碼");
  }
  return path.join(STORAGE_ROOT, storedFileName);
}

export async function writeAttachmentFile(bytes: Buffer): Promise<string> {
  await ensureStorageRoot();
  const storedFileName = randomUUID();
  await fs.writeFile(storedFilePath(storedFileName), bytes);
  return storedFileName;
}

export async function readAttachmentFile(storedFileName: string): Promise<Buffer> {
  return fs.readFile(storedFilePath(storedFileName));
}

export async function attachmentFileSize(storedFileName: string): Promise<number | null> {
  try {
    const stat = await fs.stat(storedFilePath(storedFileName));
    return stat.size;
  } catch {
    return null;
  }
}

export async function deleteAttachmentFileIfExists(storedFileName: string): Promise<void> {
  try {
    await fs.unlink(storedFilePath(storedFileName));
  } catch {
    // 檔案本就不存在時視為已刪除，不視為錯誤（例如重複點擊刪除）。
  }
}
