// 建立工單／團隊整合修正新增：工單 CRUD／刪除權限服務層。
//
// 兩種刪除入口，授權與前置條件完全不同，但底層「實際刪除＋清理關聯資料」共用同一段邏輯：
// - deleteOwnDraftIssue：申請人刪除自己「尚未正式送簽」的工單（限第一關／被駁回退回第一關，
//   且沒有 active pending ApprovalRecord、沒有 RD／QA／OP 已產生的作業資料）。
// - adminPermanentDeleteIssue：Admin（active UserRole 的 admin.full 能力）可在任何階段永久刪除，
//   但必須填寫原因、再次輸入工單編號確認，且刪除稽核紀錄（AuditLog）不會因 Issue 被刪除而遺失
//   ——AuditLog.entityId 只是純字串欄位、沒有指向 Issue 的外來鍵（見 prisma/schema.prisma
//   AuditLog model），因此在同一 transaction 內「先刪 Issue、再寫入這筆刪除稽核紀錄」是安全的，
//   不屬於「若 AuditLog 因 FK 限制而無法保留」那個必須停止的情境。
//
// ApprovalRecord／StageRiskCheck／IssueWorkflowStageHistory 三個資料表對 Issue 的關聯刻意使用
// onDelete: Restrict（見 schema 註解，核准治理與流程歷程不得因 Issue 刪除而悄悄消失），因此
// 直接 prisma.issue.delete() 在這三張表有資料列時會被資料庫拒絕；本服務在同一 transaction 內
// 依正確順序（StageRiskCheck → ApprovalRecord → IssueWorkflowStageHistory → Issue）先手動清空，
// 才刪除 Issue 本體。IssueFieldValue／Evidence／Comment／AiSuggestion 對 Issue 使用
// onDelete: Cascade，刪除 Issue 時由資料庫自動一併清除，不需手動處理。

import { prisma } from "../prisma";
import { requireCapability } from "../permissions";
import { writeAuditLog } from "../audit";
import { getWorkflow } from "../workflow";
import { ATTACHMENT_URL_PREFIX, deleteAttachmentFileIfExists } from "../hotfix-ui/attachmentStorage";
import type { Prisma } from "@prisma/client";

export class IssueDeletionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IssueDeletionValidationError";
  }
}

export class IssueDeletionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IssueDeletionStateError";
  }
}

export class IssueDeletionAccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IssueDeletionAccessDeniedError";
  }
}

type Tx = Prisma.TransactionClient;

async function collectAttachmentStoredFileNames(tx: Tx, issueId: string): Promise<string[]> {
  const evidences = await tx.evidence.findMany({ where: { issueId, url: { startsWith: ATTACHMENT_URL_PREFIX } } });
  return evidences.map((e) => e.url.slice(ATTACHMENT_URL_PREFIX.length));
}

// 共用底層刪除邏輯：在同一 transaction 內依 FK 相依順序清空關聯資料後刪除 Issue 本體，
// 並回傳需要在 transaction 成功提交後清掉的實體附件檔名（DB 交易失敗時，實體檔案本來就
// 沒被動到，不需要另外復原）。
async function deleteIssueAndRelationsTx(tx: Tx, issueId: string): Promise<string[]> {
  const storedFileNames = await collectAttachmentStoredFileNames(tx, issueId);
  await tx.stageRiskCheck.deleteMany({ where: { issueId } });
  await tx.approvalRecord.deleteMany({ where: { issueId } });
  await tx.issueWorkflowStageHistory.deleteMany({ where: { issueId } });
  await tx.issue.delete({ where: { id: issueId } });
  return storedFileNames;
}

async function purgeAttachmentFiles(storedFileNames: string[]): Promise<void> {
  for (const name of storedFileNames) {
    await deleteAttachmentFileIfExists(name);
  }
}

// ---------------------------------------------------------------------------
// 申請人刪除自己尚未正式送簽的工單
// ---------------------------------------------------------------------------

const RD_QA_OP_FIELD_KEY_PREFIXES = ["rd", "qa", "op"] as const;

async function hasRdQaOpWorkData(tx: Tx, issueId: string): Promise<boolean> {
  const rows = await tx.issueFieldValue.findMany({ where: { issueId }, select: { fieldKey: true } });
  return rows.some((r) => RD_QA_OP_FIELD_KEY_PREFIXES.some((p) => r.fieldKey.toLowerCase().startsWith(p)));
}

export async function canApplicantDeleteIssue(issueId: string, actorId: string): Promise<{ allowed: boolean; reason?: string }> {
  const issue = await prisma.issue.findUnique({ where: { id: issueId } });
  if (!issue) return { allowed: false, reason: "找不到此工單" };
  if (issue.reporterUserId !== actorId) return { allowed: false, reason: "僅申請人本人可刪除自己的工單" };

  if (issue.workflowVersionId && issue.currentWorkflowStageId) {
    const stage = await prisma.workflowStage.findUnique({ where: { id: issue.currentWorkflowStageId } });
    if (!stage || stage.stageKey !== "draft") {
      return { allowed: false, reason: "此工單已進入正式處理流程，無法直接刪除。如需停止處理，請使用取消 Hotfix。" };
    }
  } else {
    const workflow = getWorkflow(issue.issueType);
    if (workflow.length > 0 && issue.workflowStatus !== workflow[0].key) {
      return { allowed: false, reason: "此工單已進入正式處理流程，無法直接刪除。" };
    }
  }

  const activePending = await prisma.approvalRecord.findFirst({ where: { issueId, recordStatus: "ACTIVE", decision: "PENDING" } });
  if (activePending) return { allowed: false, reason: "此工單目前有待處理的核准紀錄，無法刪除。" };

  if (issue.issueType === "Hotfix" && (await hasRdQaOpWorkData(prisma, issueId))) {
    return { allowed: false, reason: "此工單已產生 RD／QA／OP 作業資料，無法刪除。" };
  }

  return { allowed: true };
}

export async function deleteOwnDraftIssue(input: { issueId: string; actorId: string }): Promise<void> {
  const check = await canApplicantDeleteIssue(input.issueId, input.actorId);
  if (!check.allowed) throw new IssueDeletionStateError(check.reason ?? "此工單目前無法刪除");

  const issue = await prisma.issue.findUniqueOrThrow({ where: { id: input.issueId } });

  const storedFileNames = await prisma.$transaction((tx) => deleteIssueAndRelationsTx(tx, input.issueId));
  await purgeAttachmentFiles(storedFileNames);

  await writeAuditLog({
    entityType: "Issue",
    entityId: input.issueId,
    actionType: "IssueDeleted",
    summary: `申請人刪除自己尚未送簽的工單「${issue.issueKey}」「${issue.title}」`,
    actorUserId: input.actorId,
  });
}

// ---------------------------------------------------------------------------
// Admin 永久刪除（任何階段）
// ---------------------------------------------------------------------------

export interface AdminDeleteImpactSummary {
  issueKey: string;
  title: string;
  currentStageLabel: string | null;
  applicantName: string;
  teamName: string | null;
  approvalRecordCount: number;
  historyCount: number;
  attachmentCount: number;
}

export async function loadAdminDeleteImpactSummary(issueId: string): Promise<AdminDeleteImpactSummary> {
  const issue = await prisma.issue.findUniqueOrThrow({ where: { id: issueId } });
  const [stage, team, approvalRecordCount, historyCount, attachmentCount] = await Promise.all([
    issue.currentWorkflowStageId ? prisma.workflowStage.findUnique({ where: { id: issue.currentWorkflowStageId } }) : Promise.resolve(null),
    issue.assignedTeamId ? prisma.team.findUnique({ where: { id: issue.assignedTeamId } }) : Promise.resolve(null),
    prisma.approvalRecord.count({ where: { issueId } }),
    prisma.issueWorkflowStageHistory.count({ where: { issueId } }),
    prisma.evidence.count({ where: { issueId, url: { startsWith: ATTACHMENT_URL_PREFIX } } }),
  ]);
  return {
    issueKey: issue.issueKey,
    title: issue.title,
    currentStageLabel: stage?.label ?? (issue.workflowVersionId ? null : issue.workflowStatus),
    applicantName: issue.reporter || "（未指定）",
    teamName: team?.name ?? null,
    approvalRecordCount,
    historyCount,
    attachmentCount,
  };
}

const MAX_DELETE_REASON_LENGTH = 500;

export async function adminPermanentDeleteIssue(input: { issueId: string; actorId: string; reason: string; confirmIssueKey: string }): Promise<void> {
  try {
    await requireCapability({ id: input.actorId }, "admin.full");
  } catch {
    throw new IssueDeletionAccessDeniedError("僅系統管理員（Admin）可永久刪除工單");
  }

  const reason = input.reason.trim();
  if (!reason) throw new IssueDeletionValidationError("永久刪除必須填寫原因");
  if (reason.length > MAX_DELETE_REASON_LENGTH) throw new IssueDeletionValidationError(`刪除原因不得超過 ${MAX_DELETE_REASON_LENGTH} 字`);

  const issue = await prisma.issue.findUnique({ where: { id: input.issueId } });
  if (!issue) throw new IssueDeletionStateError("找不到此工單");
  if (input.confirmIssueKey.trim() !== issue.issueKey) {
    throw new IssueDeletionValidationError("再次輸入的工單編號不相符，請重新確認");
  }

  const storedFileNames = await prisma.$transaction(async (tx) => {
    const names = await deleteIssueAndRelationsTx(tx, input.issueId);
    await writeAuditLog(
      {
        entityType: "Issue",
        entityId: input.issueId,
        actionType: "IssueAdminPermanentDeleted",
        summary: `Admin 永久刪除工單「${issue.issueKey}」「${issue.title}」，原因：${reason}`,
        actorUserId: input.actorId,
        reasonCode: reason,
      },
      tx,
    );
    return names;
  });

  await purgeAttachmentFiles(storedFileNames);
}
