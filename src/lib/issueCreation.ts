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
import { requireCapability } from "./permissions";
import { assertCreationTeamAndApplicant } from "./team-applicant/issueCreationScope";
import { HOTFIX_PRIORITY_FIELD_KEY, HOTFIX_PRIORITIES } from "./hotfix-ui/priority";
import { resolveUniqueAutoStartVersionForIssueType, startWorkflowForIssueSystemTx, executeIssueTransitionInTx } from "./workflowExecutionService";
import { missingDraftFields } from "./hotfix-ui/draftService";
import { allocateNextIssueKey, isTransientTransactionConflict } from "./issue-key-sequence";
import { ENVIRONMENTS, PRIORITIES, RISK_LEVELS, isChangeSubType, isValidSystemName } from "./constants";
import { Prisma } from "@prisma/client";
import type { User } from "@prisma/client";
import { normalizeHotfixTitleForStorage } from "./hotfix-ui/title";
import { createIssueRelationInTx } from "./issue-relations/service";

const CREATE_ISSUE_TRANSACTION_MAX_ATTEMPTS = 3;

export class UnauthorizedIssueCreationError extends Error {
  constructor(message = "建立工單需要合法且已啟用的登入使用者，未授權呼叫已拒絕") {
    super(message);
    this.name = "UnauthorizedIssueCreationError";
  }
}

// 雙重提交流程修正新增：按「建立工單」時必填欄位不齊，於任何寫入前就拒絕。
export class IssueCreationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IssueCreationValidationError";
  }
}

export interface CreateIssueOptions {
  /**
   * true：於「同一個 transaction」內建立 Issue、啟動流程、完成第 1 關，並直接送出至
   * 第 2 關「申請人直屬主管簽核」（含建立 pending ApprovalRecord）。任何一步失敗整組
   * 回滾，不留下半成品 Issue／孤兒 ApprovalRecord／已完成第 1 關卻沒有核准人的工單。
   *
   * false（預設）：只建立草稿並停在第 1 關，不建立 ApprovalRecord、不推進 Workflow。
   */
  submitForApproval?: boolean;
}

interface HotfixCreationRelations {
  incidentIds: string[];
  rcaIds: string[];
  projectId: string | null;
}

function uniqueFormIds(formData: FormData, name: string): string[] {
  return [
    ...new Set(
      formData
        .getAll(name)
        .map(String)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

function readHotfixCreationRelations(
  issueType: string,
  formData: FormData,
): HotfixCreationRelations {
  const relateIncidents = String(formData.get("relateIncidents") ?? "no") === "yes";
  const relateRcas = String(formData.get("relateRcas") ?? "no") === "yes";
  const relateProject = String(formData.get("relateProject") ?? "no") === "yes";
  const submittedIncidentIds = uniqueFormIds(formData, "incidentRelationIds");
  const submittedRcaIds = uniqueFormIds(formData, "rcaRelationIds");
  const submittedProjectId = String(formData.get("projectRelationId") ?? "").trim();

  if (
    issueType !== "Hotfix" &&
    (relateIncidents ||
      relateRcas ||
      relateProject ||
      submittedIncidentIds.length > 0 ||
      submittedRcaIds.length > 0 ||
      submittedProjectId !== "")
  ) {
    throw new IssueCreationValidationError("只有 Hotfix 建立流程可同時建立治理紀錄關聯。");
  }
  if (issueType !== "Hotfix") {
    return { incidentIds: [], rcaIds: [], projectId: null };
  }
  if (relateProject && !submittedProjectId) {
    throw new IssueCreationValidationError("請選擇關聯專案。");
  }

  return {
    incidentIds: relateIncidents ? submittedIncidentIds : [],
    rcaIds: relateRcas ? submittedRcaIds : [],
    projectId: relateProject ? submittedProjectId : null,
  };
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
export async function createIssueForActor(
  actorInput: User | null | undefined,
  formData: FormData,
  options: CreateIssueOptions = {},
) {
  if (!actorInput || !actorInput.isActive) {
    throw new UnauthorizedIssueCreationError();
  }
  const actor = actorInput; // 固定為 const，供下方巢狀 transaction 函式安全捕捉（見 runCreateIssueTransaction）
  // 建立工單／團隊整合修正：建立工單需要 issue.edit 能力（依 active UserRole 判斷，不得
  // 依 User.role），與其他所有寫入路徑（updateIssueAction／workflow-execution）採同一套
  // 授權入口一致。
  await requireCapability(actor, "issue.edit");

  const issueType = String(formData.get("issueType") || "");
  const submittedChangeSubType = String(formData.get("changeSubType") || "");
  const changeSubType = issueType === "ChangeRelease" ? submittedChangeSubType : null;
  if (issueType === "ChangeRelease" && !isChangeSubType(submittedChangeSubType)) {
    throw new IssueCreationValidationError("請從新增事項選擇有效的季度專案類型。");
  }
  const workflow = getWorkflow(issueType);
  if (workflow.length === 0) {
    throw new IssueCreationValidationError("無效的工單類型");
  }

  const rawTitle = String(formData.get("title") || "").trim();
  const title = issueType === "Hotfix" ? normalizeHotfixTitleForStorage(rawTitle) : rawTitle;
  const description = String(formData.get("description") || "");
  const systemName = String(formData.get("systemName") || "");
  const environment = String(formData.get("environment") || "");
  const riskLevel = String(formData.get("riskLevel") || "");
  const priority = String(formData.get("priority") || "");
  const dueDateRaw = String(formData.get("dueDate") || "");
  const hotfixPriority = String(formData.get("hotfixPriority") || "");
  const hotfixCreationRelations = readHotfixCreationRelations(issueType, formData);

  // 系統名稱值域收斂：前端已改為固定四項下拉選單，但一律不信任——非空值必須落在
  // SYSTEM_NAME_OPTIONS 內，偽造其他 systemName（含既有歷史工單的舊系統名稱）一律拒絕。
  // 空值只在「暫存」時允許（沿用既有草稿可不完整的規則），正式建立時由下方必填檢查擋下。
  if (systemName !== "" && !isValidSystemName(systemName)) {
    throw new IssueCreationValidationError("請選擇系統名稱");
  }
  if (environment !== "" && !ENVIRONMENTS.includes(environment)) {
    throw new IssueCreationValidationError("請選擇環境");
  }
  if (riskLevel !== "" && !RISK_LEVELS.includes(riskLevel)) {
    throw new IssueCreationValidationError("請選擇風險等級");
  }
  if (priority !== "" && !PRIORITIES.includes(priority)) {
    throw new IssueCreationValidationError("請選擇優先級");
  }
  if (hotfixPriority !== "" && !HOTFIX_PRIORITIES.some((p) => p.value === hotfixPriority)) {
    throw new IssueCreationValidationError("請選擇緊急程度");
  }
  if (dueDateRaw !== "" && Number.isNaN(new Date(dueDateRaw).getTime())) {
    throw new IssueCreationValidationError("請選擇有效的預計完成日");
  }

  // 團隊名稱／申請人一律伺服器端重新推導身分後驗證，不信任前端下拉選單結果、hidden input
  // 或任何 isAdmin／isLead／role 宣稱：一般成員只能 applicant=自己＋自己的正式團隊；團隊
  // 主管只能使用自己擔任 active LEAD 的團隊並選該團隊 active 成員；只有 Admin 可跨團隊代建。
  const teamId = String(formData.get("teamId") || "");
  const applicantId = String(formData.get("applicantId") || "");
  if (!teamId) throw new IssueCreationValidationError("請選擇團隊名稱");
  if (!applicantId) throw new IssueCreationValidationError("請選擇申請人");
  await assertCreationTeamAndApplicant(actor.id, teamId, applicantId);

  const initialStatus = workflow[0].key;
  const waitingRole = suggestWaitingRole(issueType, initialStatus);

  // 雙重提交流程修正：要求「建立後直接送簽」時，Hotfix 必填欄位必須在任何寫入之前就檢查
  // 完畢——不得先建出一張缺欄位的草稿，再要求使用者到第 1 關頁面補齊後按第二次送出。
  const submitForApproval = options.submitForApproval === true;
  if (submitForApproval) {
    const baseFields = {
      title,
      description,
      systemName,
      environment,
      riskLevel,
      dueDate: dueDateRaw,
      hotfixPriority,
      teamId,
      applicantId,
    };
    const missing =
      issueType === "Hotfix"
        ? missingDraftFields(baseFields)
        : missingDraftFields(baseFields).filter((label) => label !== "緊急程度");
    if (missing.length > 0) {
      throw new IssueCreationValidationError(`請先填寫必填欄位：${missing.join("、")}`);
    }
  }

  // M2-B：逐 issueType opt-in（Plan 第八節第 4 點）——若此 issueType 已有可供選用的 Published
  // WorkflowVersion（所屬 Definition 必須 isActive=true），新 Issue 於建立當下即自動啟動該
  // 版本的執行引擎（固定使用此版本，不隨日後新版本發布改變）；否則行為與今天完全一致，
  // 純粹沿用舊有 workflowStatus 線性流程，不受影響。同一 Definition 有多個 Published 版本
  // 時取版號最大者；但若有兩個以上「不同」Definition 同時符合此 issueType，唯一選擇規則
  // 不存在，resolveUniqueAutoStartVersionForIssueType fail closed 回傳 null，退回舊模型，
  // 不得依查詢回傳順序任意挑選（見該函式內完整規則說明）。
  const versionToStart = await resolveUniqueAutoStartVersionForIssueType(issueType);

  // 工單編號根因修正：取號（IssueKeySequence 原子遞增）與 Issue 建立必須在同一 transaction
  // 內，任一步失敗整組回滾，該號碼視為從未配發，不會留下「號碼已消耗但沒有對應工單」的
  // 缺口以外的副作用（號碼本身因回滾而不算數）。只對可判斷為暫時性交易衝突的錯誤
  // （isTransientTransactionConflict）重試整個 transaction，最多 3 次嘗試；其餘錯誤
  // （授權/驗證/業務規則拒絕等）第一次就直接往外拋，不得重試。
  //
  // 動態欄位（建立工單時只處理建單當下就已顯示的欄位，後續關卡欄位待推進至該關卡才會
  // 出現在表單上）與團隊資料，必須在 retry 迴圈「之前」先求值——runCreateIssueTransaction
  // 會捕捉這兩個 const，若宣告寫在迴圈之後，第一次呼叫時它們仍在 TDZ，會直接 ReferenceError。
  const template = getVisibleFieldTemplate(issueType, initialStatus);
  const dynamicFieldRows = template
    .map((f) => ({ fieldKey: f.key, fieldLabel: f.label, fieldValue: readDynFieldValue(formData, f) }))
    .filter((row) => row.fieldValue !== "");

  let issue!: Awaited<ReturnType<typeof runCreateIssueTransaction>>;
  for (let attempt = 1; ; attempt++) {
    try {
      issue = await runCreateIssueTransaction();
      break;
    } catch (err) {
      if (attempt >= CREATE_ISSUE_TRANSACTION_MAX_ATTEMPTS || !isTransientTransactionConflict(err)) {
        throw err;
      }
    }
  }

  async function runCreateIssueTransaction() {
    return prisma.$transaction(async (tx) => {
      // 寫入 transaction 內再次解析 scope，避免權限檢查與實際建立之間的團隊／成員狀態
      // 變更造成 TOCTOU。actor 與 applicant 分開保存：reporterUserId 是申請人，
      // AuditLog.actorUserId 是實際建立者。
      const applicant = await assertCreationTeamAndApplicant(actor.id, teamId, applicantId, tx);
      const team = await tx.team.findUniqueOrThrow({ where: { id: teamId } });
      const issueKey = await allocateNextIssueKey(tx, issueType);
      const created = await tx.issue.create({
        data: {
          issueKey,
          issueType,
          changeSubType,
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

      // 欄位值必須與 Issue 同一 transaction 寫入：下方送簽時關卡 Requirement 會讀取這些
      // 欄位，若留到 transaction 之外寫入，送簽當下會看到「欄位還不存在」而誤判為未填。
      for (const row of dynamicFieldRows) {
        await tx.issueFieldValue.create({ data: { issueId: created.id, ...row } });
      }
      if (issueType === "Hotfix" && HOTFIX_PRIORITIES.some((p) => p.value === hotfixPriority)) {
        await tx.issueFieldValue.create({
          data: { issueId: created.id, fieldKey: HOTFIX_PRIORITY_FIELD_KEY, fieldLabel: "緊急程度", fieldValue: hotfixPriority },
        });
      }

      // AuditLog 必須能回答：誰建立這張工單（actorUserId＝actor）、代表哪位申請人建立
      // （summary 內的申請人姓名）、選擇哪個團隊、建立時間（createdAt）、工單編號（entityId／
      // issueKey）。actor 與 applicant 可能不同（例如 Admin 代團隊成員建立），這裡明確分開記錄，
      // 不得把申請人當成登入 actor、也不得反過來把 actor 覆寫成申請人。
      const actorVsApplicantNote = actor.id === applicant.id ? "" : `，實際建立者：${actor.name}`;
      await writeAuditLog(
        {
          entityType: "Issue",
          entityId: created.id,
          actionType: "IssueCreated",
          summary: `建立工單「${created.issueKey}」「${created.title}」，申請人：${applicant.name}${actorVsApplicantNote}，團隊：${team?.name ?? teamId}，初始關卡：${statusLabel(issueType, initialStatus)}`,
          actorUserId: actor.id,
        },
        tx,
      );

      // 治理紀錄關聯與 Issue、IssueCreated AuditLog、Workflow 啟動／送簽共用同一個 tx。
      // 前端只提交所選 ID；relationType 與固定方向由 Server 在此建立，正式服務仍會依
      // DB 中實際類型、有效狀態、active UserRole visibility／management 權限重新驗證。
      for (const incidentId of hotfixCreationRelations.incidentIds) {
        await createIssueRelationInTx(
          actor.id,
          {
            sourceIssueId: incidentId,
            targetIssueId: created.id,
            relationType: "INCIDENT_TO_HOTFIX",
          },
          tx,
        );
      }
      for (const rcaId of hotfixCreationRelations.rcaIds) {
        await createIssueRelationInTx(
          actor.id,
          {
            sourceIssueId: rcaId,
            targetIssueId: created.id,
            relationType: "RCA_TO_HOTFIX",
          },
          tx,
        );
      }
      if (hotfixCreationRelations.projectId) {
        await createIssueRelationInTx(
          actor.id,
          {
            sourceIssueId: created.id,
            targetIssueId: hotfixCreationRelations.projectId,
            relationType: "HOTFIX_TO_PROJECT",
          },
          tx,
        );
      }

      if (!versionToStart) {
        // 尚未導入執行引擎的 issueType：維持舊有線性 workflowStatus 行為，沒有第 2 關可送。
        return created;
      }

      await startWorkflowForIssueSystemTx(tx, {
        issueId: created.id,
        workflowVersionId: versionToStart.id,
        actorId: actor.id,
        reasonCode: "ISSUE_CREATED_AUTO_START",
      });

      if (submitForApproval) {
        await submitCreatedIssueForApprovalTx(tx, created.id, actor.id);
      }

      return tx.issue.findUniqueOrThrow({ where: { id: created.id } });
    });
  }

  await recalcIssue(issue.id);

  return issue;
}

// 雙重提交流程修正：在「建立工單」的同一個 transaction 內，緊接著完成第 1 關並推進到
// 第 2 關「申請人直屬主管簽核」。
//
// 一律走既有的 executeIssueTransitionInTx（與 UI 送簽同一條路徑），不另外手寫一套推進
// 邏輯——關卡資格、Requirement 檢查、Workflow History、ApprovalRecord 建立（含
// 直屬主管解析與 fail closed）全部沿用既有實作。找不到合法主管時
// createRequiredApprovalRecordIfNeeded 會拋出 NoEligibleApproverError，本 transaction
// 整組回滾，不會留下任何半成品資料。
async function submitCreatedIssueForApprovalTx(tx: Prisma.TransactionClient, issueId: string, actorId: string) {
  const issue = await tx.issue.findUniqueOrThrow({ where: { id: issueId } });
  if (!issue.workflowVersionId || !issue.currentWorkflowStageId) {
    throw new IssueCreationValidationError("工單流程尚未啟動，無法送出簽核");
  }

  const forwardTransitions = await tx.workflowTransition.findMany({
    where: {
      workflowVersionId: issue.workflowVersionId,
      fromStageId: issue.currentWorkflowStageId,
      transitionType: "FORWARD",
    },
  });
  // fail closed：起始關卡的 FORWARD 出邊必須唯一，否則無法判斷該送往哪一關，不得任意挑選。
  if (forwardTransitions.length !== 1) {
    throw new IssueCreationValidationError("此工單流程的送出路徑不唯一或不存在，無法自動送出簽核");
  }

  await executeIssueTransitionInTx(tx, {
    issueId,
    transitionId: forwardTransitions[0].id,
    actorId,
    reasonCode: "HOTFIX_TICKET_SUBMITTED",
  });
}
