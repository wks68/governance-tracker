"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import {
  DYNAMIC_FIELDS,
  getInitialStatus,
  getIssueType,
  getWorkflow,
  ROLES
} from "@/lib/governance";
import {
  displayAiSuggestionType,
  displayBlockReason,
  displayIssueType,
  displayWorkflowStatus
} from "@/lib/i18n";
import { generateMockAiSuggestion, AI_SUGGESTION_TYPES } from "@/lib/ai";
import { deriveIssueState, evaluateGateRules } from "@/lib/rules";
import type { IssueWithRelations } from "@/lib/types";

function text(formData: FormData, key: string, fallback = ""): string {
  const value = formData.get(key);
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function optionalText(formData: FormData, key: string): string | null {
  const value = text(formData, key);
  return value.length > 0 ? value : null;
}

function bool(formData: FormData, key: string): boolean {
  return formData.get(key) === "on" || formData.get(key) === "true";
}

function actor(formData: FormData) {
  const actorRole = text(formData, "actorRole", "Admin");

  return {
    actorRole: ROLES.includes(actorRole as (typeof ROLES)[number]) ? actorRole : "Admin",
    actorName: text(formData, "actorName", "MVP User")
  };
}

function dateFromInput(value: string): Date {
  if (!value) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(18, 0, 0, 0);
    return tomorrow;
  }

  return new Date(`${value}T18:00:00`);
}

async function getIssueWithRelations(issueId: string): Promise<IssueWithRelations | null> {
  return db.issue.findUnique({
    where: { id: issueId },
    include: {
      fieldValues: true,
      evidence: true,
      comments: true,
      auditLogs: true,
      aiSuggestions: true
    }
  });
}

async function refreshIssueState(issueId: string) {
  const issue = await getIssueWithRelations(issueId);

  if (!issue) {
    return;
  }

  const derived = deriveIssueState(issue);

  await db.issue.update({
    where: { id: issueId },
    data: derived
  });
}

async function upsertDynamicFields(issueId: string, issueType: string, formData: FormData) {
  const templates = DYNAMIC_FIELDS[getIssueType(issueType)];

  await Promise.all(
    templates.map((field) =>
      db.issueFieldValue.upsert({
        where: {
          issueId_fieldKey: {
            issueId,
            fieldKey: field.key
          }
        },
        update: {
          fieldLabel: field.label,
          fieldValue: text(formData, `field:${field.key}`)
        },
        create: {
          issueId,
          fieldKey: field.key,
          fieldLabel: field.label,
          fieldValue: text(formData, `field:${field.key}`)
        }
      })
    )
  );
}

export async function createIssueAction(formData: FormData) {
  const selectedIssueType = getIssueType(text(formData, "issueType", "Hotfix"));
  const issueCount = await db.issue.count();
  const issueKey = `DMS-${String(issueCount + 1001).padStart(4, "0")}`;
  const { actorRole, actorName } = actor(formData);

  const issue = await db.issue.create({
    data: {
      issueKey,
      issueType: selectedIssueType,
      title: text(formData, "title", "Untitled governance item"),
      description: text(formData, "description"),
      systemName: text(formData, "systemName", "Unassigned System"),
      environment: text(formData, "environment", "Production"),
      riskLevel: text(formData, "riskLevel", "Medium"),
      priority: text(formData, "priority", "P3"),
      ownerRole: text(formData, "ownerRole", actorRole),
      ownerName: text(formData, "ownerName", actorName),
      reporter: text(formData, "reporter", actorName),
      workflowStatus: getInitialStatus(selectedIssueType),
      statusLight: "Yellow",
      dueDate: dateFromInput(text(formData, "dueDate")),
      needRca: bool(formData, "needRca"),
      needRiskException: bool(formData, "needRiskException"),
      impactProduction: bool(formData, "impactProduction"),
      evidenceStatus: "Missing",
      waitingRole: optionalText(formData, "waitingRole"),
      nextStep: "Initial triage required.",
      auditLogs: {
        create: {
          actionType: "Issue Created",
          actionSummary: `${issueKey} 已建立為 ${displayIssueType(selectedIssueType)}。`,
          actorRole,
          actorName
        }
      }
    }
  });

  await upsertDynamicFields(issue.id, selectedIssueType, formData);
  await refreshIssueState(issue.id);

  revalidatePath("/");
  redirect(`/issues/${issue.id}`);
}

export async function updateIssueAction(issueId: string, formData: FormData) {
  const issue = await db.issue.findUnique({ where: { id: issueId } });

  if (!issue) {
    redirect("/issues");
  }

  const { actorRole, actorName } = actor(formData);

  await db.issue.update({
    where: { id: issueId },
    data: {
      title: text(formData, "title", issue.title),
      description: text(formData, "description"),
      systemName: text(formData, "systemName", issue.systemName),
      environment: text(formData, "environment", issue.environment),
      riskLevel: text(formData, "riskLevel", issue.riskLevel),
      priority: text(formData, "priority", issue.priority),
      ownerRole: text(formData, "ownerRole", issue.ownerRole),
      ownerName: text(formData, "ownerName", issue.ownerName),
      reporter: text(formData, "reporter", issue.reporter),
      dueDate: dateFromInput(text(formData, "dueDate")),
      needRca: bool(formData, "needRca"),
      needRiskException: bool(formData, "needRiskException"),
      impactProduction: bool(formData, "impactProduction"),
      waitingRole: optionalText(formData, "waitingRole"),
      auditLogs: {
        create: {
          actionType: "Issue Updated",
          actionSummary: "已更新基本欄位與動態表單值。",
          actorRole,
          actorName
        }
      }
    }
  });

  await upsertDynamicFields(issueId, issue.issueType, formData);
  await refreshIssueState(issueId);

  revalidatePath("/");
  redirect(`/issues/${issueId}`);
}

export async function transitionIssueAction(issueId: string, formData: FormData) {
  const targetStatus = text(formData, "targetStatus");
  const issue = await getIssueWithRelations(issueId);

  if (!issue) {
    redirect("/issues");
  }

  const { actorRole, actorName } = actor(formData);
  const workflow = getWorkflow(issue.issueType);

  if (!workflow.includes(targetStatus)) {
    redirect(`/issues/${issueId}?error=${encodeURIComponent("流程狀態無效。")}`);
  }

  const gate = evaluateGateRules(issue, targetStatus);

  if (!gate.passed) {
    await db.auditLog.create({
      data: {
        issueId,
        actionType: "Transition Blocked",
        actionSummary: displayBlockReason([
          ...gate.missingFields,
          ...gate.missingEvidence,
          ...gate.blockReasons
        ].join("; ")),
        actorRole,
        actorName
      }
    });

    await refreshIssueState(issueId);
    revalidatePath(`/issues/${issueId}`);
    redirect(
      `/issues/${issueId}?error=${encodeURIComponent(
        "關卡規則阻擋此次流程移動，請檢查關卡規則檢查區塊。"
      )}`
    );
  }

  await db.issue.update({
    where: { id: issueId },
    data: {
      workflowStatus: targetStatus,
      closedAt: targetStatus === "Closed" ? new Date() : null,
      auditLogs: {
        create: {
          actionType: "Workflow Transition",
          actionSummary: `流程已由 ${displayWorkflowStatus(issue.workflowStatus)} 移動至 ${displayWorkflowStatus(targetStatus)}。`,
          actorRole,
          actorName
        }
      }
    }
  });

  await refreshIssueState(issueId);
  revalidatePath("/");
  redirect(`/issues/${issueId}`);
}

export async function addCommentAction(issueId: string, formData: FormData) {
  const { actorRole, actorName } = actor(formData);
  const body = text(formData, "body");

  if (!body) {
    redirect(`/issues/${issueId}`);
  }

  await db.comment.create({
    data: {
      issueId,
      authorRole: actorRole,
      authorName: actorName,
      body
    }
  });

  await db.auditLog.create({
    data: {
      issueId,
      actionType: "Comment Added",
      actionSummary: `${actorName} 已新增留言。`,
      actorRole,
      actorName
    }
  });

  await refreshIssueState(issueId);
  revalidatePath(`/issues/${issueId}`);
  redirect(`/issues/${issueId}`);
}

export async function addEvidenceAction(issueId: string, formData: FormData) {
  const { actorRole, actorName } = actor(formData);
  const title = text(formData, "title");
  const url = text(formData, "url");

  if (!title || !url) {
    redirect(`/issues/${issueId}`);
  }

  await db.evidence.create({
    data: {
      issueId,
      type: text(formData, "type", "Link"),
      title,
      url,
      description: text(formData, "description")
    }
  });

  await db.auditLog.create({
    data: {
      issueId,
      actionType: "Evidence Added",
      actionSummary: `已新增佐證連結：${title}。`,
      actorRole,
      actorName
    }
  });

  await refreshIssueState(issueId);
  revalidatePath(`/issues/${issueId}`);
  redirect(`/issues/${issueId}`);
}

export async function generateAiSuggestionAction(issueId: string, formData: FormData) {
  const suggestionType = text(formData, "suggestionType", "Suggest Next Step");
  const issue = await getIssueWithRelations(issueId);

  if (!issue) {
    redirect("/issues");
  }

  const normalizedType = AI_SUGGESTION_TYPES.includes(
    suggestionType as (typeof AI_SUGGESTION_TYPES)[number]
  )
    ? (suggestionType as (typeof AI_SUGGESTION_TYPES)[number])
    : "Suggest Next Step";
  const { actorRole, actorName } = actor(formData);
  const suggestion = generateMockAiSuggestion(issue, normalizedType);

  await db.aiSuggestion.create({
    data: {
      issueId,
      ...suggestion
    }
  });

  await db.auditLog.create({
    data: {
      issueId,
      actionType: "AI Suggestion Generated",
      actionSummary: `已產生 ${displayAiSuggestionType(normalizedType)} 草稿。`,
      actorRole,
      actorName
    }
  });

  revalidatePath(`/issues/${issueId}`);
  redirect(`/issues/${issueId}`);
}
