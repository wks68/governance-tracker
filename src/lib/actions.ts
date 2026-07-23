"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "./prisma";
import { writeAuditLog } from "./audit";
import { calculateStatusLight, suggestWaitingRole } from "./statusLight";
import { evaluateGateRules } from "./gateRules";
import { getVisibleFieldTemplate, getWorkflow, nextStatusOf, prevStatusOf, isClosed } from "./workflow";
import { ISSUE_TYPE_PREFIX, RoleKey, ROLES } from "./constants";
import { generateAiSuggestion, AiSuggestionType, AiContext } from "./mockAi";
import { requireCurrentUser, requireAdmin } from "./auth";

// ---------------------------------------------------------------------------
// 共用工具
// ---------------------------------------------------------------------------

async function generateIssueKey(issueType: string): Promise<string> {
  const prefix = ISSUE_TYPE_PREFIX[issueType] ?? "ISSUE";
  const count = await prisma.issue.count({ where: { issueType } });
  const seq = String(count + 1).padStart(4, "0");
  return `${prefix}-${seq}`;
}

async function getFieldsMap(issueId: string): Promise<Record<string, string>> {
  const rows = await prisma.issueFieldValue.findMany({ where: { issueId } });
  const map: Record<string, string> = {};
  for (const r of rows) map[r.fieldKey] = r.fieldValue;
  return map;
}

// 依欄位型別，從 FormData 讀出該動態欄位目前的值（字串化）
function readDynFieldValue(formData: FormData, f: { key: string; type: string }): string {
  const name = `dyn__${f.key}`;
  if (f.type === "checkbox") {
    return formData.get(name) === "on" ? "true" : "false";
  }
  if (f.type === "checkboxGroup") {
    return formData.getAll(name).map(String).join("、");
  }
  return String(formData.get(name) ?? "");
}

// 依目前欄位、佐證、留言重新計算狀態燈號、卡關原因、下一步建議等衍生欄位
async function recalcIssue(issueId: string) {
  const issue = await prisma.issue.findUniqueOrThrow({ where: { id: issueId } });
  const fields = await getFieldsMap(issueId);
  fields["__impactProduction"] = issue.impactProduction ? "true" : "false";

  const evidenceCount = await prisma.evidence.count({ where: { issueId } });
  const commentCount = await prisma.comment.count({ where: { issueId } });
  const hasClosingComment = commentCount > 0;

  const nextStatus = nextStatusOf(issue.issueType, issue.workflowStatus) ?? issue.workflowStatus;
  const gate = evaluateGateRules({
    issueType: issue.issueType,
    riskLevel: issue.riskLevel,
    currentStatus: issue.workflowStatus,
    targetStatus: nextStatus,
    fields,
    needRca: issue.needRca,
    needRiskException: issue.needRiskException,
    evidenceCount,
    hasClosingComment,
  });

  const waitingRole = isClosed(issue.issueType, issue.workflowStatus)
    ? ""
    : suggestWaitingRole(issue.issueType, issue.workflowStatus);

  const { light } = calculateStatusLight({
    issueType: issue.issueType,
    riskLevel: issue.riskLevel,
    workflowStatus: issue.workflowStatus,
    dueDate: issue.dueDate,
    waitingRole,
    needRca: issue.needRca,
    needRiskException: issue.needRiskException,
    alertLevel: issue.alertLevel,
    firstResponseAt: issue.firstResponseAt,
    fields,
    evidenceCount,
    hasClosingComment,
  });

  let evidenceStatus = "齊備";
  if (evidenceCount === 0) evidenceStatus = "缺漏";
  else if (gate.missingEvidence.length > 0) evidenceStatus = "部分缺漏";

  const blockReason = gate.blockReasons[0] ?? (gate.missingFields.length > 0 ? `尚缺欄位：${gate.missingFields.join("、")}` : "");

  await prisma.issue.update({
    where: { id: issueId },
    data: {
      statusLight: light,
      waitingRole,
      evidenceStatus,
      blockReason,
      nextStep: gate.nextStep,
    },
  });
}

// 依 userId 查詢「已啟用」使用者，作為負責人 / 建立人的來源（不接受任意輸入）
async function findActiveUserOrNull(userId: string) {
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive) return null;
  return user;
}

// ---------------------------------------------------------------------------
// 建立工單
// ---------------------------------------------------------------------------

export async function createIssueAction(formData: FormData) {
  const currentUser = await requireCurrentUser();

  const issueType = String(formData.get("issueType") || "");
  const workflow = getWorkflow(issueType);
  if (workflow.length === 0) {
    throw new Error("無效的工單類型");
  }

  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "");
  const systemName = String(formData.get("systemName") || "");
  const environment = String(formData.get("environment") || "");
  const riskLevel = String(formData.get("riskLevel") || "");
  const priority = String(formData.get("priority") || "");
  const ownerUserId = String(formData.get("ownerUserId") || "");
  const reporterUserId = String(formData.get("reporterUserId") || "");
  const dueDateRaw = String(formData.get("dueDate") || "");
  const alertLevel = String(formData.get("alertLevel") || "");
  const needRca = formData.get("needRca") === "on";
  const needRiskException = formData.get("needRiskException") === "on";
  const impactProduction = formData.get("impactProduction") === "on";

  // 負責人、建立人一律只能從已啟用的使用者資料中選擇，不接受任意輸入
  const owner = await findActiveUserOrNull(ownerUserId);
  const reporterUser = await findActiveUserOrNull(reporterUserId);

  const issueKey = await generateIssueKey(issueType);
  const initialStatus = workflow[0];
  const waitingRole = suggestWaitingRole(issueType, initialStatus);

  const issue = await prisma.issue.create({
    data: {
      issueKey,
      issueType,
      title: title || `未命名${issueType}工單`,
      description,
      systemName,
      environment,
      riskLevel,
      priority,
      ownerUserId: owner?.id ?? null,
      ownerName: owner?.name ?? "",
      ownerRole: owner?.role ?? "",
      reporterUserId: reporterUser?.id ?? null,
      reporter: reporterUser?.name ?? "",
      workflowStatus: initialStatus,
      statusLight: "Green",
      dueDate: dueDateRaw ? new Date(dueDateRaw) : null,
      needRca,
      needRiskException,
      impactProduction,
      alertLevel,
      waitingRole,
    },
  });

  // 動態欄位（建立工單時只處理建單當下就已顯示的欄位，後續關卡欄位待推進至該關卡才會出現在表單上）
  const template = getVisibleFieldTemplate(issueType, initialStatus);
  for (const f of template) {
    const value = readDynFieldValue(formData, f);
    if (value !== "") {
      await prisma.issueFieldValue.create({
        data: { issueId: issue.id, fieldKey: f.key, fieldLabel: f.label, fieldValue: value },
      });
    }
  }

  await writeAuditLog({
    entityType: "Issue",
    entityId: issue.id,
    actionType: "IssueCreated",
    summary: `建立工單「${issue.title}」，初始關卡：${initialStatus}`,
    actorUserId: currentUser.id,
  });

  await recalcIssue(issue.id);

  revalidatePath("/dashboard");
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

  const ownerUserIdRaw = String(formData.get("ownerUserId") || "");
  const reporterUserIdRaw = String(formData.get("reporterUserId") || "");

  // 工單轉派時，只能從已啟用的使用者中選擇；若選擇的使用者已停用或不存在則維持原負責人
  const owner = ownerUserIdRaw ? await findActiveUserOrNull(ownerUserIdRaw) : null;
  const reporterUser = reporterUserIdRaw ? await findActiveUserOrNull(reporterUserIdRaw) : null;

  const newOwnerName = owner?.name ?? issue.ownerName;
  const newOwnerRole = owner?.role ?? issue.ownerRole;
  const newOwnerUserId = owner?.id ?? issue.ownerUserId;
  const newReporterName = reporterUser?.name ?? issue.reporter;
  const newReporterUserId = reporterUser?.id ?? issue.reporterUserId;

  const baseFields: Record<string, string> = {
    title: String(formData.get("title") || issue.title),
    description: String(formData.get("description") || issue.description),
    systemName: String(formData.get("systemName") || issue.systemName),
    environment: String(formData.get("environment") || issue.environment),
    riskLevel: String(formData.get("riskLevel") || issue.riskLevel),
    priority: String(formData.get("priority") || issue.priority),
    ownerRole: newOwnerRole,
    ownerName: newOwnerName,
    reporter: newReporterName,
    alertLevel: String(formData.get("alertLevel") || issue.alertLevel),
  };

  const labelMap: Record<string, string> = {
    title: "標題",
    description: "問題描述",
    systemName: "系統名稱",
    environment: "環境",
    riskLevel: "風險等級",
    priority: "優先級",
    ownerRole: "負責角色",
    ownerName: "負責人",
    reporter: "建立人",
    alertLevel: "告警等級",
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

  const needRca = formData.get("needRca") === "on";
  const needRiskException = formData.get("needRiskException") === "on";
  const impactProduction = formData.get("impactProduction") === "on";
  if (needRca !== issue.needRca) changes.push(`是否需 RCA：「${issue.needRca ? "是" : "否"}」→「${needRca ? "是" : "否"}」`);
  if (needRiskException !== issue.needRiskException) changes.push(`是否需風險例外：「${issue.needRiskException ? "是" : "否"}」→「${needRiskException ? "是" : "否"}」`);
  if (impactProduction !== issue.impactProduction) changes.push(`是否影響正式環境：「${issue.impactProduction ? "是" : "否"}」→「${impactProduction ? "是" : "否"}」`);

  await prisma.issue.update({
    where: { id: issueId },
    data: {
      ...baseFields,
      ownerUserId: newOwnerUserId,
      reporterUserId: newReporterUserId,
      dueDate: newDueDate,
      needRca,
      needRiskException,
      impactProduction,
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
  revalidatePath("/dashboard");
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
  revalidatePath("/dashboard");
  revalidatePath("/issues");
}

// ---------------------------------------------------------------------------
// 流程狀態流轉
// ---------------------------------------------------------------------------

export async function transitionStatusAction(issueId: string, direction: "next" | "back") {
  const currentUser = await requireCurrentUser();
  const issue = await prisma.issue.findUniqueOrThrow({ where: { id: issueId } });

  if (direction === "back") {
    const prev = prevStatusOf(issue.issueType, issue.workflowStatus);
    if (!prev) return;
    await prisma.issue.update({ where: { id: issueId }, data: { workflowStatus: prev, closedAt: null } });
    await writeAuditLog({
      entityType: "Issue",
      entityId: issueId,
      actionType: "StatusChange",
      summary: `流程退回：${issue.workflowStatus} → ${prev}`,
      actorUserId: currentUser.id,
    });
    await recalcIssue(issueId);
    revalidatePath(`/issues/${issueId}`);
    revalidatePath("/dashboard");
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
    summary: `流程推進：${issue.workflowStatus} → ${next}`,
    actorUserId: currentUser.id,
  });

  await recalcIssue(issueId);
  revalidatePath(`/issues/${issueId}`);
  revalidatePath("/dashboard");
  revalidatePath("/issues");
}

const QA_STAGES_CAN_SEND_BACK = ["QA驗證", "QA放行確認"];
const SEND_BACK_TARGET_STATUS = "RD修正";

// QA 關卡不通過時，可直接發回給 RD（不同於一般退回上一關），且必須填寫發回訊息
export async function sendBackToRdAction(issueId: string, formData: FormData) {
  const currentUser = await requireCurrentUser();
  const issue = await prisma.issue.findUniqueOrThrow({ where: { id: issueId } });

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
    summary: `QA 發回 RD：${issue.workflowStatus} → ${SEND_BACK_TARGET_STATUS}，訊息：${message}`,
    actorUserId: currentUser.id,
  });

  await recalcIssue(issueId);
  revalidatePath(`/issues/${issueId}`);
  revalidatePath("/dashboard");
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
  revalidatePath("/dashboard");
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
  revalidatePath("/dashboard");
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
    workflowStatus: issue.workflowStatus,
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
// ---------------------------------------------------------------------------

export async function assignUserRoleAction(formData: FormData) {
  const admin = await requireAdmin();
  const targetUserId = String(formData.get("userId") || "");
  const newRole = String(formData.get("role") || "") as RoleKey;

  if (!ROLES.some((r) => r.key === newRole)) {
    throw new Error("無效的角色");
  }

  const target = await prisma.user.findUniqueOrThrow({ where: { id: targetUserId } });
  if (target.role !== newRole) {
    await prisma.user.update({ where: { id: targetUserId }, data: { role: newRole } });
    await writeAuditLog({
      entityType: "User",
      entityId: target.id,
      actionType: "RoleChange",
      summary: `將使用者「${target.name}」的角色從「${target.role}」變更為「${newRole}」`,
      actorUserId: admin.id,
    });
  }

  revalidatePath("/admin/users");
}

export async function setUserActiveAction(formData: FormData) {
  const admin = await requireAdmin();
  const targetUserId = String(formData.get("userId") || "");
  const nextActive = String(formData.get("isActive") || "") === "true";

  const target = await prisma.user.findUniqueOrThrow({ where: { id: targetUserId } });
  if (target.isActive !== nextActive) {
    await prisma.user.update({ where: { id: targetUserId }, data: { isActive: nextActive } });
    await writeAuditLog({
      entityType: "User",
      entityId: target.id,
      actionType: "AccountStatusChange",
      summary: `將使用者「${target.name}」的帳號狀態變更為「${nextActive ? "啟用" : "停用"}」`,
      actorUserId: admin.id,
    });
  }

  revalidatePath("/admin/users");
}
