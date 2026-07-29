// Hotfix 九階段 UI：附件（選填）服務層——上傳／刪除／列出。一律現場重新查詢 Issue 目前
// 關卡與 actor 資格（不信任呼叫端宣稱的 stageKey），比照 workflow-execution 既有信任邊界
// 慣例。UI／Server Action 一律呼叫本檔案，不直接 Prisma、不直接碰磁碟。

import { prisma } from "../prisma";
import { evaluateActorEligibilityForStage } from "../workflowExecutionService";
import { writeAttachmentFile, deleteAttachmentFileIfExists, attachmentFileSize, MAX_ATTACHMENT_BYTES, ATTACHMENT_URL_PREFIX } from "./attachmentStorage";
import { nineStageIndexOfStageKey, nineStageLabelOfIndex } from "./nineStage";
import { canActorEditHotfixDraft } from "./draftService";

export class AttachmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentValidationError";
  }
}

export class AttachmentAuthorizationError extends Error {
  constructor(message: string = "沒有權限操作此附件") {
    super(message);
    this.name = "AttachmentAuthorizationError";
  }
}

interface AttachmentMeta {
  stageKey: string;
  uploaderUserId: string;
  uploaderName: string;
}

function encodeMeta(meta: AttachmentMeta): string {
  return JSON.stringify(meta);
}

function decodeMeta(description: string): AttachmentMeta | null {
  try {
    const parsed = JSON.parse(description);
    if (typeof parsed?.stageKey === "string" && typeof parsed?.uploaderUserId === "string") {
      return { stageKey: parsed.stageKey, uploaderUserId: parsed.uploaderUserId, uploaderName: parsed.uploaderName ?? "" };
    }
    return null;
  } catch {
    return null;
  }
}

// 「目前這一關的 actor 是否有權上傳／刪除附件」：與執行頁可編輯欄位同一套資格（RD/QA/OP
// 執行人身分，或 stage1/stage9 的原始填單人）；主管簽核頁一律唯讀預覽，不得呼叫本函式。
async function requireActorCanManageAttachmentsForCurrentStage(issueId: string, actorId: string): Promise<{ stageKey: string; assignedTeamId: string | null }> {
  const issue = await prisma.issue.findUnique({ where: { id: issueId } });
  if (!issue || issue.issueType !== "Hotfix" || !issue.currentWorkflowStageId) {
    throw new AttachmentValidationError("此工單目前無法操作附件");
  }
  const stage = await prisma.workflowStage.findUniqueOrThrow({ where: { id: issue.currentWorkflowStageId } });

  if (stage.stageType === "APPROVAL") {
    throw new AttachmentAuthorizationError("主管簽核頁僅能預覽附件，不得上傳或刪除");
  }

  // stage1 允許實際建立者或申請人操作附件；兩者在 Admin／主管代建時不是同一人。
  if (stage.stageKey === "draft") {
    if (!(await canActorEditHotfixDraft(issueId, actorId))) {
      throw new AttachmentAuthorizationError("僅實際建立者或申請人可於此關卡操作附件");
    }
    return { stageKey: stage.stageKey, assignedTeamId: issue.assignedTeamId };
  }

  // stage9 的責任角色固定為申請人。
  if (stage.stageKey === "pendingReporterConfirmation" || stage.stageKey === "reporterConfirming") {
    if (issue.reporterUserId !== actorId) {
      throw new AttachmentAuthorizationError("僅原始填單人可於此關卡操作附件");
    }
    return { stageKey: stage.stageKey, assignedTeamId: issue.assignedTeamId };
  }

  const eligibility = await evaluateActorEligibilityForStage(
    prisma,
    actorId,
    { assignedTeamId: issue.assignedTeamId },
    { requiredExecutionRole: stage.requiredExecutionRole, requiredMembershipRole: stage.requiredMembershipRole, stageKey: stage.stageKey },
  );
  if (!eligibility.eligible) {
    throw new AttachmentAuthorizationError(`不具備在目前關卡操作附件的資格：${eligibility.reasons.join("; ")}`);
  }
  return { stageKey: stage.stageKey, assignedTeamId: issue.assignedTeamId };
}

export interface UploadAttachmentInput {
  issueId: string;
  actorId: string;
  actorName: string;
  fileName: string;
  mimeType: string;
  bytes: Buffer;
}

export async function uploadHotfixAttachment(input: UploadAttachmentInput) {
  if (input.bytes.length === 0) throw new AttachmentValidationError("檔案內容為空");
  if (input.bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentValidationError(`檔案大小超過上限（${Math.floor(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB）`);
  }
  const { stageKey } = await requireActorCanManageAttachmentsForCurrentStage(input.issueId, input.actorId);

  const storedFileName = await writeAttachmentFile(input.bytes);
  const evidence = await prisma.evidence.create({
    data: {
      issueId: input.issueId,
      type: input.mimeType || "application/octet-stream",
      title: input.fileName || "未命名檔案",
      url: `${ATTACHMENT_URL_PREFIX}${storedFileName}`,
      description: encodeMeta({ stageKey, uploaderUserId: input.actorId, uploaderName: input.actorName }),
    },
  });
  return evidence;
}

export async function deleteHotfixAttachment(input: { issueId: string; evidenceId: string; actorId: string }) {
  const { stageKey } = await requireActorCanManageAttachmentsForCurrentStage(input.issueId, input.actorId);

  const evidence = await prisma.evidence.findUnique({ where: { id: input.evidenceId } });
  if (!evidence || evidence.issueId !== input.issueId || !evidence.url.startsWith(ATTACHMENT_URL_PREFIX)) {
    throw new AttachmentValidationError("找不到此附件");
  }
  const meta = decodeMeta(evidence.description);
  if (!meta || meta.stageKey !== stageKey) {
    throw new AttachmentAuthorizationError("僅能刪除目前這一關上傳的附件，已完成關卡的附件唯讀");
  }

  const storedFileName = evidence.url.slice(ATTACHMENT_URL_PREFIX.length);
  await prisma.evidence.delete({ where: { id: evidence.id } });
  await deleteAttachmentFileIfExists(storedFileName);
}

export interface HotfixAttachmentView {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number | null;
  stageKey: string;
  stageLabel: string;
  uploaderName: string;
  uploadedAt: string;
  url: string;
  deletable: boolean;
}

export async function listHotfixAttachments(issueId: string, opts?: { actorId?: string; currentStageKey?: string }): Promise<HotfixAttachmentView[]> {
  const rows = await prisma.evidence.findMany({
    where: { issueId, url: { startsWith: ATTACHMENT_URL_PREFIX } },
    orderBy: { createdAt: "asc" },
  });

  let canManageCurrentStage = false;
  if (opts?.actorId) {
    try {
      await requireActorCanManageAttachmentsForCurrentStage(issueId, opts.actorId);
      canManageCurrentStage = true;
    } catch {
      canManageCurrentStage = false;
    }
  }

  const result: HotfixAttachmentView[] = [];
  for (const row of rows) {
    const meta = decodeMeta(row.description);
    const storedFileName = row.url.slice(ATTACHMENT_URL_PREFIX.length);
    const sizeBytes = await attachmentFileSize(storedFileName);
    const stageKey = meta?.stageKey ?? "";
    const nineIdx = nineStageIndexOfStageKey(stageKey);
    result.push({
      id: row.id,
      fileName: row.title,
      mimeType: row.type,
      sizeBytes,
      stageKey,
      stageLabel: nineIdx ? nineStageLabelOfIndex(nineIdx) : stageKey || "（未知關卡）",
      uploaderName: meta?.uploaderName || "（未知）",
      uploadedAt: row.createdAt.toISOString(),
      url: row.url,
      deletable: canManageCurrentStage && meta?.stageKey === opts?.currentStageKey,
    });
  }
  return result;
}
