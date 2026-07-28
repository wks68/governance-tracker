"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "./prisma";
import { writeAuditLog } from "./audit";
import { evaluateGateRules } from "./gateRules";
import { getVisibleFieldTemplate, nextStatusOf, prevStatusOf, isClosed, statusLabel } from "./workflow";
import { generateAiSuggestion, AiSuggestionType, AiContext } from "./mockAi";
import { requireCurrentUser } from "./auth";
import { isIssueOnVersionedWorkflow } from "./workflowExecutionService";
import { createIssueForActor, getFieldsMap, readDynFieldValue, recalcIssue } from "./issueCreation";
import { assertActorCanUseTeam, assertValidApplicantForTeam } from "./team-applicant/teamApplicantService";

// ---------------------------------------------------------------------------
// 建立工單
// ---------------------------------------------------------------------------

export async function createIssueAction(formData: FormData) {
  const currentUser = await requireCurrentUser();
  const issue = await createIssueForActor(currentUser, formData);

  revalidatePath("/governance");
  revalidatePath("/issues");
  redirect(`/issues/${issue.id}`);
}

// ---------------------------------------------------------------------------
// 編輯工單（基本欄位 + 動態欄位）
// ---------------------------------------------------------------------------

export async function updateIssueAction(issueId: string, formData: FormData) {
  const currentUser = await requireCurrentUser();
  const issue = await prisma.issue.findUniqueOrThrow({ where: { id: issueId } });

  const changes: string[] = [];

  const baseFields: Record<string, string> = {
    title: String(formData.get("title") || issue.title),
    description: String(formData.get("description") || issue.description),
    systemName: String(formData.get("systemName") || issue.systemName),
    environment: String(formData.get("environment") || issue.environment),
    riskLevel: String(formData.get("riskLevel") || issue.riskLevel),
    priority: String(formData.get("priority") || issue.priority),
  };

  const labelMap: Record<string, string> = {
    title: "標題",
    description: "問題描述",
    systemName: "系統名稱",
    environment: "環境",
    riskLevel: "風險等級",
    priority: "優先級",
  };

  for (const key of Object.keys(baseFields)) {
    const oldVal = (issue as any)[key] ?? "";
    if (baseFields[key] !== oldVal) {
      changes.push(`${labelMap[key]}：「${oldVal || "（空白）"}」→「${baseFields[key] || "（空白）"}」`);
    }
  }

  const dueDateRaw = String(formData.get("dueDate") || "");
  const newDueDate = dueDateRaw ? new Date(dueDateRaw) : null;
  if ((issue.dueDate?.toISOString().slice(0, 10) || "") !== (newDueDate?.toISOString().slice(0, 10) || "")) {
    changes.push(`到期日：「${issue.dueDate ? issue.dueDate.toISOString().slice(0, 10) : "（空白）"}」→「${newDueDate ? newDueDate.toISOString().slice(0, 10) : "（空白）"}」`);
  }

  // 團隊／申請人：一律伺服器端重新驗證，不信任前端下拉選單結果。此頁只服務尚未啟動新版
  // Hotfix 流程引擎的工單（見 EditIssuePage 的 redirect 守門），沒有 pending ApprovalRecord
  // 需要作廢／重建的概念，純粹是欄位更新。
  const teamId = String(formData.get("teamId") || "");
  const applicantId = String(formData.get("applicantId") || "");
  let newReporterUserId = issue.reporterUserId;
  let newReporterName = issue.reporter;
  let newAssignedTeamId = issue.assignedTeamId;
  if (teamId && applicantId) {
    await assertActorCanUseTeam(currentUser.id, teamId);
    const applicant = await assertValidApplicantForTeam(teamId, applicantId);
    if (teamId !== issue.assignedTeamId) {
      const team = await prisma.team.findUnique({ where: { id: teamId } });
      changes.push(`團隊：「${issue.assignedTeamId ?? "（未指派）"}」→「${team?.name ?? teamId}」`);
      newAssignedTeamId = teamId;
    }
    if (applicant.id !== issue.reporterUserId) {
      changes.push(`申請人：「${issue.reporter || "（空白）"}」→「${applicant.name}」`);
      newReporterUserId = applicant.id;
      newReporterName = applicant.name;
    }
  }

  await prisma.issue.update({
    where: { id: issueId },
    data: {
      ...baseFields,
      reporterUserId: newReporterUserId,
      reporter: newReporterName,
      assignedTeamId: newAssignedTeamId,
      dueDate: newDueDate,
    },
  });

  // 只處理目前關卡（含）之前已顯示在編輯表單上的欄位，尚未到達的關卡欄位保持不動
  const template = getVisibleFieldTemplate(issue.issueType, issue.workflowStatus);
  const existing = await prisma.issueFieldValue.findMany({ where: { issueId } });
  const existingMap = new Map(existing.map((e) => [e.fieldKey, e.fieldValue]));

  for (const f of template) {
    const value = readDynFieldValue(formData, f);
    const oldVal = existingMap.get(f.key) ?? "";
    if (value !== oldVal) {
      changes.push(`${f.label}：「${oldVal || "（空白）"}」→「${value || "（空白）"}」`);
      await prisma.issueFieldValue.upsert({
        where: { issueId_fieldKey: { issueId, fieldKey: f.key } },
        create: { issueId, fieldKey: f.key, fieldLabel: f.label, fieldValue: value },
        update: { fieldValue: value },
      });
    }
  }

  if (changes.length > 0) {
    await writeAuditLog({
      entityType: "Issue",
      entityId: issueId,
      actionType: "FieldChange",
      summary: `更新欄位：${changes.join("；")}`,
      actorUserId: currentUser.id,
    });
  }

  await recalcIssue(issueId);
  revalidatePath(`/issues/${issueId}`);
  revalidatePath("/governance");
  revalidatePath("/issues");
  redirect(`/issues/${issueId}`);
}

// ---------------------------------------------------------------------------
// 動態欄位就地更新（工單詳情頁直接填寫目前關卡欄位，不需要離開此頁）
// ---------------------------------------------------------------------------

export async function updateDynamicFieldsAction(issueId: string, formData: FormData) {
  const currentUser = await requireCurrentUser();
  const issue = await prisma.issue.findUniqueOrThrow({ where: { id: issueId } });

  const changes: string[] = [];
  const template = getVisibleFieldTemplate(issue.issueType, issue.workflowStatus);
  const existing = await prisma.issueFieldValue.findMany({ where: { issueId } });
  const existingMap = new Map(existing.map((e) => [e.fieldKey, e.fieldValue]));

  for (const f of template) {
    const value = readDynFieldValue(formData, f);
    const oldVal = existingMap.get(f.key) ?? "";
    if (value !== oldVal) {
      changes.push(`${f.label}：「${oldVal || "（空白）"}」→「${value || "（空白）"}」`);
      await prisma.issueFieldValue.upsert({
        where: { issueId_fieldKey: { issueId, fieldKey: f.key } },
        create: { issueId, fieldKey: f.key, fieldLabel: f.label, fieldValue: value },
        update: { fieldValue: value },
      });
    }
  }

  if (changes.length > 0) {
    await writeAuditLog({
      entityType: "Issue",
      entityId: issueId,
      actionType: "FieldChange",
      summary: `更新欄位：${changes.join("；")}`,
      actorUserId: currentUser.id,
    });
  }

  await recalcIssue(issueId);
  revalidatePath(`/issues/${issueId}`);
  revalidatePath("/governance");
  revalidatePath("/issues");
}

// ---------------------------------------------------------------------------
// 流程狀態流轉
// ---------------------------------------------------------------------------

export async function transitionStatusAction(issueId: string, direction: "next" | "back") {
  const currentUser = await requireCurrentUser();
  const issue = await prisma.issue.findUniqueOrThrow({ where: { id: issueId } });

  // M2-B：新流程 Issue 一律只能透過 workflowExecutionService 的 FORWARD／RETURN／CANCEL
  // 執行，不得再被這個舊有的線性 workflowStatus 推進/退回動作觸碰，否則會繞過關卡資格、
  // Requirement、Approval 等所有執行期驗證，直接破壞 currentWorkflowStageId 與
  // workflowStatus 的一致性。
  if (isIssueOnVersionedWorkflow(issue)) {
    throw new Error("此工單已採用新版 Workflow 執行引擎，請於工單詳情頁的「流程執行」區塊操作");
  }

  if (direction === "back") {
    const prev = prevStatusOf(issue.issueType, issue.workflowStatus);
    if (!prev) return;
    await prisma.issue.update({ where: { id: issueId }, data: { workflowStatus: prev, closedAt: null } });
    await writeAuditLog({
      entityType: "Issue",
      entityId: issueId,
      actionType: "StatusChange",
      summary: `流程退回：${statusLabel(issue.issueType, issue.workflowStatus)} → ${statusLabel(issue.issueType, prev)}`,
      actorUserId: currentUser.id,
    });
    await recalcIssue(issueId);
    revalidatePath(`/issues/${issueId}`);
    revalidatePath("/governance");
    revalidatePath("/issues");
    return;
  }

  const next = nextStatusOf(issue.issueType, issue.workflowStatus);
  if (!next) return;

  const fields = await getFieldsMap(issueId);
  fields["__impactProduction"] = issue.impactProduction ? "true" : "false";
  const evidenceCount = await prisma.evidence.count({ where: { issueId } });
  const commentCount = await prisma.comment.count({ where: { issueId } });

  const gate = evaluateGateRules({
    issueType: issue.issueType,
    riskLevel: issue.riskLevel,
    currentStatus: issue.workflowStatus,
    targetStatus: next,
    fields,
    needRca: issue.needRca,
    needRiskException: issue.needRiskException,
    evidenceCount,
    hasClosingComment: commentCount > 0,
  });

  if (!gate.passed) {
    // 關卡卡控未通過，阻擋流轉（伺服器端二次防護；畫面上按鈕已停用）
    return;
  }

  const isNowClosed = isClosed(issue.issueType, next);
  await prisma.issue.update({
    where: { id: issueId },
    data: { workflowStatus: next, closedAt: isNowClosed ? new Date() : null },
  });

  await writeAuditLog({
    entityType: "Issue",
    entityId: issueId,
    actionType: "StatusChange",
    summary: `流程推進：${statusLabel(issue.issueType, issue.workflowStatus)} → ${statusLabel(issue.issueType, next)}`,
    actorUserId: currentUser.id,
  });

  await recalcIssue(issueId);
  revalidatePath(`/issues/${issueId}`);
  revalidatePath("/governance");
  revalidatePath("/issues");
}

const QA_STAGES_CAN_SEND_BACK = ["qaVerify", "qaRelease"];
const SEND_BACK_TARGET_STATUS = "rdFix";

// QA 關卡不通過時，可直接發回給 RD（不同於一般退回上一關），且必須填寫發回訊息
export async function sendBackToRdAction(issueId: string, formData: FormData) {
  const currentUser = await requireCurrentUser();
  const issue = await prisma.issue.findUniqueOrThrow({ where: { id: issueId } });

  if (isIssueOnVersionedWorkflow(issue)) {
    throw new Error("此工單已採用新版 Workflow 執行引擎，請於工單詳情頁的「流程執行」區塊使用 RETURN 操作");
  }

  const message = String(formData.get("message") || "").trim();
  if (!message) {
    throw new Error("發回給 RD 前必須填寫發回訊息");
  }
  if (issue.issueType !== "Hotfix" || !QA_STAGES_CAN_SEND_BACK.includes(issue.workflowStatus)) {
    throw new Error("目前關卡不可發回給 RD");
  }

  await prisma.issue.update({
    where: { id: issueId },
    data: { workflowStatus: SEND_BACK_TARGET_STATUS, closedAt: null },
  });

  await prisma.comment.create({
    data: {
      issueId,
      authorRole: currentUser.role,
      authorName: currentUser.name,
      body: `【發回 RD】${message}`,
    },
  });

  await writeAuditLog({
    entityType: "Issue",
    entityId: issueId,
    actionType: "StatusChange",
    summary: `QA 發回 RD：${statusLabel(issue.issueType, issue.workflowStatus)} → ${statusLabel(issue.issueType, SEND_BACK_TARGET_STATUS)}，訊息：${message}`,
    actorUserId: currentUser.id,
  });

  await recalcIssue(issueId);
  revalidatePath(`/issues/${issueId}`);
  revalidatePath("/governance");
  revalidatePath("/issues");
}

// ---------------------------------------------------------------------------
// 留言
// ---------------------------------------------------------------------------

export async function addCommentAction(issueId: string, formData: FormData) {
  const body = String(formData.get("body") || "").trim();
  if (!body) return;
  const currentUser = await requireCurrentUser();

  await prisma.comment.create({
    data: { issueId, authorRole: currentUser.role, authorName: currentUser.name, body },
  });

  await writeAuditLog({
    entityType: "Issue",
    entityId: issueId,
    actionType: "CommentAdded",
    summary: `新增留言：${body.slice(0, 30)}${body.length > 30 ? "..." : ""}`,
    actorUserId: currentUser.id,
  });

  await recalcIssue(issueId);
  revalidatePath(`/issues/${issueId}`);
  revalidatePath("/governance");
}

// ---------------------------------------------------------------------------
// 佐證資料
// ---------------------------------------------------------------------------

export async function addEvidenceAction(issueId: string, formData: FormData) {
  const type = String(formData.get("type") || "其他");
  const title = String(formData.get("title") || "").trim();
  const url = String(formData.get("url") || "").trim();
  const description = String(formData.get("description") || "");
  if (!title || !url) return;

  const currentUser = await requireCurrentUser();

  await prisma.evidence.create({
    data: { issueId, type, title, url, description },
  });

  await writeAuditLog({
    entityType: "Issue",
    entityId: issueId,
    actionType: "EvidenceAdded",
    summary: `新增佐證資料：[${type}] ${title}`,
    actorUserId: currentUser.id,
  });

  await recalcIssue(issueId);
  revalidatePath(`/issues/${issueId}`);
  revalidatePath("/governance");
}

// ---------------------------------------------------------------------------
// Mock AI 輔助
// ---------------------------------------------------------------------------

export async function runAiAction(issueId: string, suggestionType: AiSuggestionType) {
  const currentUser = await requireCurrentUser();
  const issue = await prisma.issue.findUniqueOrThrow({ where: { id: issueId } });
  const fields = await getFieldsMap(issueId);
  fields["__impactProduction"] = issue.impactProduction ? "true" : "false";
  const evidenceCount = await prisma.evidence.count({ where: { issueId } });
  const commentCount = await prisma.comment.count({ where: { issueId } });

  const next = nextStatusOf(issue.issueType, issue.workflowStatus) ?? issue.workflowStatus;
  const gate = evaluateGateRules({
    issueType: issue.issueType,
    riskLevel: issue.riskLevel,
    currentStatus: issue.workflowStatus,
    targetStatus: next,
    fields,
    needRca: issue.needRca,
    needRiskException: issue.needRiskException,
    evidenceCount,
    hasClosingComment: commentCount > 0,
  });

  const { issueTypeLabel } = await import("./constants");
  const ctx: AiContext = {
    issueKey: issue.issueKey,
    issueType: issue.issueType,
    issueTypeLabel: issueTypeLabel(issue.issueType),
    title: issue.title,
    description: issue.description,
    systemName: issue.systemName,
    environment: issue.environment,
    riskLevel: issue.riskLevel,
    workflowStatus: statusLabel(issue.issueType, issue.workflowStatus),
    missingFields: gate.missingFields,
    missingEvidence: gate.missingEvidence,
    evidenceCount,
  };

  const output = generateAiSuggestion(suggestionType, ctx);

  await prisma.aiSuggestion.create({
    data: {
      issueId,
      suggestionType,
      prompt: `type=${suggestionType}`,
      output,
      accepted: false,
    },
  });

  await writeAuditLog({
    entityType: "Issue",
    entityId: issueId,
    actionType: "AiSuggestion",
    summary: `AI 輔助產生草稿：${suggestionType}`,
    actorUserId: currentUser.id,
  });

  revalidatePath(`/issues/${issueId}`);
}

// ---------------------------------------------------------------------------
// 管理員：使用者與角色管理
//
// M1.5-C1-C：舊版 assignUserRoleAction／setUserActiveAction（C1-B5 fail-closed 過渡版）
// 已由 src/app/admin/people/actions.ts（assignSystemRoleAction／updatePrimaryRoleAction／
// activatePersonAction／deactivatePersonAction，皆呼叫同一套 peopleService）完整取代，
// 本檔案不再保留任何直接寫入 User.role／isActive 的入口。
// ---------------------------------------------------------------------------
