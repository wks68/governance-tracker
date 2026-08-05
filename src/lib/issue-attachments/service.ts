// 跨 Incident／RCA 共用的附件服務層，比照 src/lib/hotfix-ui/attachmentService.ts 既有設計
// （真正檔案位元組寫本地磁碟＋Evidence row 存中繼資料），刻意重用同一組底層原語
// （attachmentStorage.ts／Evidence model／既有 /api/hotfix-attachments/[storedFileName]
// 下載端點——該端點只依 Evidence.url 前綴查詢＋issue.view 能力檢查，本來就與 issueType
// 無關，不需另建第二套下載路由），不複製整套 Hotfix 專屬程式，也不修改 Hotfix 既有行為。
//
// 「這筆附件屬於哪個範圍」用 Evidence.description 內的 JSON meta 記錄：
//   issueType    = "Incident" | "RCA"
//   uploaderUserId／uploaderName
//   actionItemId = 選填，附件屬於某筆 RcaActionItem 的佐證時才有值（沒有新增資料表，
//                  只是最小可回溯關聯，比照任務規格「不得建立第二套檔案系統」的要求）
//
// 資格判斷刻意分 Incident／RCA／RcaActionItem 三種情境各自解析，不是 Hotfix 的
// requiredMembershipRole 通用機制可以直接套用（Incident／RCA 責任人解析本來就有自己專屬
// 的 responsibility resolver，見 incident-ui／rca-ui 既有模組），因此本檔案呼叫既有
// evaluateCurrentIncidentActorTask／evaluateCurrentRcaActorTask，不重新發明責任判斷。

import { prisma } from "../prisma";
import { writeAttachmentFile, deleteAttachmentFileIfExists, attachmentFileSize, MAX_ATTACHMENT_BYTES, ATTACHMENT_URL_PREFIX } from "../hotfix-ui/attachmentStorage";
import { repairDisplayFileName } from "../hotfix-ui/fileNameDisplay";
import { evaluateCurrentIncidentActorTask } from "../incident-ui/incidentResponsibilityService";
import { evaluateCurrentRcaActorTask } from "../rca-ui/rcaResponsibilityService";

export { MAX_ATTACHMENT_BYTES };

export class IssueAttachmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IssueAttachmentValidationError";
  }
}

export class IssueAttachmentAuthorizationError extends Error {
  constructor(message: string = "沒有權限操作此附件") {
    super(message);
    this.name = "IssueAttachmentAuthorizationError";
  }
}

interface AttachmentMeta {
  issueType: "Incident" | "RCA";
  uploaderUserId: string;
  uploaderName: string;
  actionItemId?: string;
}

function encodeMeta(meta: AttachmentMeta): string {
  return JSON.stringify(meta);
}

function decodeMeta(description: string): AttachmentMeta | null {
  try {
    const parsed = JSON.parse(description);
    if (typeof parsed?.uploaderUserId === "string" && (parsed?.issueType === "Incident" || parsed?.issueType === "RCA")) {
      return {
        issueType: parsed.issueType,
        uploaderUserId: parsed.uploaderUserId,
        uploaderName: parsed.uploaderName ?? "",
        actionItemId: typeof parsed.actionItemId === "string" ? parsed.actionItemId : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 資格判斷：上傳／刪除一律現場重新查詢，不信任呼叫端宣稱的角色。
// ---------------------------------------------------------------------------

async function canActorManageIncidentAttachments(issueId: string, actorId: string): Promise<boolean> {
  const issue = await prisma.issue.findUnique({ where: { id: issueId } });
  if (!issue || issue.issueType !== "Incident") return false;
  if (issue.reporterUserId === actorId) return true;
  const task = await evaluateCurrentIncidentActorTask(issueId, actorId);
  return task !== null && task.action !== "VIEW_ONLY";
}

async function canActorManageRcaAttachments(issueId: string, actorId: string): Promise<boolean> {
  const issue = await prisma.issue.findUnique({ where: { id: issueId } });
  if (!issue || issue.issueType !== "RCA") return false;
  const task = await evaluateCurrentRcaActorTask(issueId, actorId);
  return task !== null && task.action !== "VIEW_ONLY";
}

// 改善措施佐證：只有該措施責任人，或資安推動小組成員（治理權限）可上傳。
async function canActorManageActionItemAttachments(actionItemId: string, actorId: string): Promise<boolean> {
  const item = await prisma.rcaActionItem.findUnique({ where: { id: actionItemId } });
  if (!item) return false;
  if (item.ownerUserId === actorId) return true;
  const membership = await prisma.teamMember.findFirst({ where: { userId: actorId, isActive: true, team: { domain: "SECURITY", isActive: true } } });
  return Boolean(membership);
}

async function requireCanManage(issueId: string, actorId: string, actionItemId?: string): Promise<{ issueType: "Incident" | "RCA" }> {
  const issue = await prisma.issue.findUnique({ where: { id: issueId }, select: { issueType: true } });
  if (!issue || (issue.issueType !== "Incident" && issue.issueType !== "RCA")) {
    throw new IssueAttachmentValidationError("此工單不支援附件操作");
  }

  if (actionItemId) {
    const allowed = await canActorManageActionItemAttachments(actionItemId, actorId);
    if (!allowed) throw new IssueAttachmentAuthorizationError("僅該改善措施責任人或資安推動小組可操作此佐證附件");
    return { issueType: issue.issueType };
  }

  const allowed = issue.issueType === "Incident"
    ? await canActorManageIncidentAttachments(issueId, actorId)
    : await canActorManageRcaAttachments(issueId, actorId);
  if (!allowed) throw new IssueAttachmentAuthorizationError("僅通報人或目前責任人可操作附件");
  return { issueType: issue.issueType };
}

// ---------------------------------------------------------------------------
// 上傳／刪除／列出
// ---------------------------------------------------------------------------

export interface UploadIssueAttachmentInput {
  issueId: string;
  actorId: string;
  actorName: string;
  fileName: string;
  mimeType: string;
  bytes: Buffer;
  /** 附件屬於某筆 RCA 改善措施的佐證時提供；未提供則是 Issue 層級一般附件。 */
  actionItemId?: string;
}

export async function uploadIssueAttachment(input: UploadIssueAttachmentInput) {
  if (input.bytes.length === 0) throw new IssueAttachmentValidationError("檔案內容為空");
  if (input.bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new IssueAttachmentValidationError(`檔案大小超過上限（${Math.floor(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB）`);
  }
  const { issueType } = await requireCanManage(input.issueId, input.actorId, input.actionItemId);

  const storedFileName = await writeAttachmentFile(input.bytes);
  try {
    return await prisma.evidence.create({
      data: {
        issueId: input.issueId,
        type: input.mimeType || "application/octet-stream",
        title: input.fileName || "未命名檔案",
        url: `${ATTACHMENT_URL_PREFIX}${storedFileName}`,
        description: encodeMeta({ issueType, uploaderUserId: input.actorId, uploaderName: input.actorName, actionItemId: input.actionItemId }),
      },
    });
  } catch (error) {
    await deleteAttachmentFileIfExists(storedFileName);
    throw error;
  }
}

export async function deleteIssueAttachment(input: { issueId: string; evidenceId: string; actorId: string }) {
  const evidence = await prisma.evidence.findUnique({ where: { id: input.evidenceId } });
  if (!evidence || evidence.issueId !== input.issueId || !evidence.url.startsWith(ATTACHMENT_URL_PREFIX)) {
    throw new IssueAttachmentValidationError("找不到此附件");
  }
  const meta = decodeMeta(evidence.description);
  if (!meta) throw new IssueAttachmentValidationError("附件中繼資料異常");

  await requireCanManage(input.issueId, input.actorId, meta.actionItemId);
  if (meta.uploaderUserId !== input.actorId) {
    throw new IssueAttachmentAuthorizationError("僅上傳者本人可移除此附件");
  }

  const storedFileName = evidence.url.slice(ATTACHMENT_URL_PREFIX.length);
  await prisma.evidence.delete({ where: { id: evidence.id } });
  await deleteAttachmentFileIfExists(storedFileName);
}

export interface IssueAttachmentView {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number | null;
  uploaderName: string;
  uploadedAt: string;
  url: string;
  actionItemId: string | null;
  deletable: boolean;
}

export async function listIssueAttachments(
  issueId: string,
  opts: { actorId?: string; actionItemId?: string | null } = {},
): Promise<IssueAttachmentView[]> {
  const rows = await prisma.evidence.findMany({
    where: { issueId, url: { startsWith: ATTACHMENT_URL_PREFIX } },
    orderBy: { createdAt: "asc" },
  });

  const result: IssueAttachmentView[] = [];
  for (const row of rows) {
    const meta = decodeMeta(row.description);
    if (opts.actionItemId !== undefined && (meta?.actionItemId ?? null) !== opts.actionItemId) continue;

    const storedFileName = row.url.slice(ATTACHMENT_URL_PREFIX.length);
    const sizeBytes = await attachmentFileSize(storedFileName);

    let deletable = false;
    if (opts.actorId && meta && meta.uploaderUserId === opts.actorId) {
      try {
        await requireCanManage(issueId, opts.actorId, meta.actionItemId);
        deletable = true;
      } catch {
        deletable = false;
      }
    }

    result.push({
      id: row.id,
      fileName: repairDisplayFileName(row.title),
      mimeType: row.type,
      sizeBytes,
      uploaderName: meta?.uploaderName || "（未知）",
      uploadedAt: row.createdAt.toISOString(),
      url: row.url,
      actionItemId: meta?.actionItemId ?? null,
      deletable,
    });
  }
  return result;
}
