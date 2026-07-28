// 補強（封版前最終佐證）：createIssueAction 的已授權交易核心與其共用工具，從
// src/lib/actions.ts（"use server" 檔案，所有匯出的 async function 皆會被 Next.js
// 註冊為可從 Client 呼叫的 Server Action）搬到本檔案。
//
// 本檔案刻意不加 "use server"，只是一般的 server-only 模組，不會被 Next.js 註冊成
// Server Action、也不會出現在任何 Client Bundle 中（因為沒有任何 "use client" 元件
// import 本檔案，只有 src/lib/actions.ts 這個純伺服器模組與驗證腳本會 import 它）。
// createIssueForActor 因此可以安全地被驗證腳本以 tsx／Node 直接呼叫、注入任意 actor
// （包含 null／未啟用帳號）進行 fail-closed 動態測試，不需要、也不可能脫離
// Next.js request context 呼叫到真正的 Server Action 本身。
//
// createIssueAction（src/lib/actions.ts）仍然一律先呼叫 requireCurrentUser() 取得合法
// actor 才呼叫本檔案的 createIssueForActor——正式登入設計完全不變。
// createIssueForActor 本身額外再驗證一次 actor 是否為合法且已啟用的使用者，是
// defense-in-depth：即使日後有其他呼叫端忘記先做 requireCurrentUser()，也不會在沒有
// 合法 actor 時寫入任何資料。

import { prisma } from "./prisma";
import { writeAuditLog } from "./audit";
import { calculateStatusLight, suggestWaitingRole } from "./statusLight";
import { evaluateGateRules } from "./gateRules";
import { getVisibleFieldTemplate, getWorkflow, nextStatusOf, isClosed, statusLabel } from "./workflow";
import { ISSUE_TYPE_PREFIX } from "./constants";
import { requireCapability } from "./permissions";
import { assertActorCanUseTeam, assertValidApplicantForTeam } from "./team-applicant/teamApplicantService";
import { HOTFIX_PRIORITY_FIELD_KEY, HOTFIX_PRIORITIES } from "./hotfix-ui/priority";
import { resolveUniqueAutoStartVersionForIssueType, startWorkflowForIssueSystemTx } from "./workflowExecutionService";
import type { User } from "@prisma/client";

export class UnauthorizedIssueCreationError extends Error {
  constructor(message = "建立工單需要合法且已啟用的登入使用者，未授權呼叫已拒絕") {
    super(message);
    this.name = "UnauthorizedIssueCreationError";
  }
}

export async function generateIssueKey(issueType: string): Promise<string> {
  const prefix = ISSUE_TYPE_PREFIX[issueType] ?? "ISSUE";
  const count = await prisma.issue.count({ where: { issueType } });
  const seq = String(count + 1).padStart(4, "0");
  return `${prefix}-${seq}`;
}

export async function getFieldsMap(issueId: string): Promise<Record<string, string>> {
  const rows = await prisma.issueFieldValue.findMany({ where: { issueId } });
  const map: Record<string, string> = {};
  for (const r of rows) map[r.fieldKey] = r.fieldValue;
  return map;
}

// 依欄位型別，從 FormData 讀出該動態欄位目前的值（字串化）
export function readDynFieldValue(formData: FormData, f: { key: string; type: string }): string {
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
export async function recalcIssue(issueId: string) {
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
export async function findActiveUserOrNull(userId: string) {
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive) return null;
  return user;
}

// 已授權建立工單交易核心。呼叫端（createIssueAction）必須先呼叫 requireCurrentUser()
// 取得合法且已啟用的 actor 之後才可呼叫本函式；本函式本身也再次驗證 actor（見上方檔案
// 說明的 defense-in-depth 理由），未提供合法且已啟用的 actor 一律 fail closed，
// 在觸碰任何資料表之前就拋出 UnauthorizedIssueCreationError，不會留下任何半成品資料
// （不建立 Issue／IssueWorkflowStageHistory／AuditLog）。
//
// 只回傳建立完成的 Issue，不執行 revalidatePath／redirect——這兩個動作只在真正的
// Server Action（src/lib/actions.ts 的 createIssueAction）裡執行，本函式維持可在
// 一般 Node/tsx 環境（例如驗證腳本）直接呼叫，不依賴 Next.js request context。
export async function createIssueForActor(actor: User | null | undefined, formData: FormData) {
  if (!actor || !actor.isActive) {
    throw new UnauthorizedIssueCreationError();
  }
  // 建立工單／團隊整合修正：建立工單需要 issue.edit 能力（依 active UserRole 判斷，不得
  // 依 User.role），與其他所有寫入路徑（updateIssueAction／workflow-execution）採同一套
  // 授權入口一致。
  await requireCapability(actor, "issue.edit");

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
  const dueDateRaw = String(formData.get("dueDate") || "");
  const hotfixPriority = String(formData.get("hotfixPriority") || "");

  // 團隊名稱／申請人一律伺服器端重新驗證，不信任前端下拉選單結果或任何 hidden input：
  // teamId 必須存在，applicantId 必須是該 team 目前 active 的成員，actor 必須有權以此
  // team 建立工單（Admin 可任選；非 Admin 僅能選自己是 active 成員的團隊）。
  const teamId = String(formData.get("teamId") || "");
  const applicantId = String(formData.get("applicantId") || "");
  if (!teamId) throw new Error("請選擇團隊名稱");
  if (!applicantId) throw new Error("請選擇申請人");
  await assertActorCanUseTeam(actor.id, teamId);
  const applicant = await assertValidApplicantForTeam(teamId, applicantId);

  const issueKey = await generateIssueKey(issueType);
  const initialStatus = workflow[0].key;
  const waitingRole = suggestWaitingRole(issueType, initialStatus);

  // M2-B：逐 issueType opt-in（Plan 第八節第 4 點）——若此 issueType 已有可供選用的 Published
  // WorkflowVersion（所屬 Definition 必須 isActive=true），新 Issue 於建立當下即自動啟動該
  // 版本的執行引擎（固定使用此版本，不隨日後新版本發布改變）；否則行為與今天完全一致，
  // 純粹沿用舊有 workflowStatus 線性流程，不受影響。同一 Definition 有多個 Published 版本
  // 時取版號最大者；但若有兩個以上「不同」Definition 同時符合此 issueType，唯一選擇規則
  // 不存在，resolveUniqueAutoStartVersionForIssueType fail closed 回傳 null，退回舊模型，
  // 不得依查詢回傳順序任意挑選（見該函式內完整規則說明）。
  const versionToStart = await resolveUniqueAutoStartVersionForIssueType(issueType);

  const issue = await prisma.$transaction(async (tx) => {
    const created = await tx.issue.create({
      data: {
        issueKey,
        issueType,
        title: title || `未命名${issueType}工單`,
        description,
        systemName,
        environment,
        riskLevel,
        priority,
        reporterUserId: applicant.id,
        reporter: applicant.name,
        assignedTeamId: teamId,
        workflowStatus: initialStatus,
        statusLight: "Green",
        dueDate: dueDateRaw ? new Date(dueDateRaw) : null,
        waitingRole,
      },
    });

    if (versionToStart) {
      await startWorkflowForIssueSystemTx(tx, {
        issueId: created.id,
        workflowVersionId: versionToStart.id,
        actorId: actor.id,
        reasonCode: "ISSUE_CREATED_AUTO_START",
      });
      return tx.issue.findUniqueOrThrow({ where: { id: created.id } });
    }
    return created;
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

  if (issueType === "Hotfix" && HOTFIX_PRIORITIES.some((p) => p.value === hotfixPriority)) {
    await prisma.issueFieldValue.create({
      data: { issueId: issue.id, fieldKey: HOTFIX_PRIORITY_FIELD_KEY, fieldLabel: "Hotfix 工單優先級", fieldValue: hotfixPriority },
    });
  }

  // AuditLog 必須能回答：誰建立這張工單（actorUserId＝actor）、代表哪位申請人建立
  // （summary 內的申請人姓名）、選擇哪個團隊、建立時間（createdAt）、工單編號（entityId／
  // issueKey）。actor 與 applicant 可能不同（例如 Admin 代團隊成員建立），這裡明確分開記錄，
  // 不得把申請人當成登入 actor、也不得反過來把 actor 覆寫成申請人。
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  const actorVsApplicantNote = actor.id === applicant.id ? "" : `，實際建立者：${actor.name}`;
  await writeAuditLog({
    entityType: "Issue",
    entityId: issue.id,
    actionType: "IssueCreated",
    summary: `建立工單「${issue.issueKey}」「${issue.title}」，申請人：${applicant.name}${actorVsApplicantNote}，團隊：${team?.name ?? teamId}，初始關卡：${statusLabel(issueType, initialStatus)}`,
    actorUserId: actor.id,
  });

  await recalcIssue(issue.id);

  return issue;
}
