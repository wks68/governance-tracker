// M2-A 新增：Workflow 領域驗證——圖形、順序、可達性與發布條件驗證。
//
// 本檔案分兩類函式：
// 1. 純輸入驗證（assertReasonCodeProvided／throwIfInvalid）：不存取 DB。
// 2. validateWorkflowVersionForPublish：發布前結構化驗證（第五節 15 項），現場查詢
//    DB（Stage／Transition／Requirement／Team），只讀不寫，回傳結構化問題清單，
//    不得只丟一段字串。呼叫端（publishService）決定是否阻擋發布。
//
// 刻意不把任何 Hotfix 特例硬編碼進本檔案——本檔案只驗證「這是不是一個合法的通用
// Workflow 圖形」，不知道、也不應該知道任何特定 issueType 的業務語意。

import type { Prisma, PrismaClient } from "@prisma/client";
import { isTerminalOutcome, isWorkflowStageRequirementType, WorkflowNotFoundError } from "./types";
import type { WorkflowValidationIssue } from "./types";
import { isApprovalType } from "../constants";

type Client = PrismaClient | Prisma.TransactionClient;

export function assertReasonCodeProvided(reasonCode: string | undefined | null, issues: string[]): void {
  if (!reasonCode?.trim()) issues.push("reasonCode 不得為空");
}

export function throwIfInvalid(issues: string[], ErrorClass: new (issues: string[]) => Error): void {
  if (issues.length > 0) throw new ErrorClass(issues);
}

function issue(
  code: string,
  severity: "error" | "warning",
  entityType: WorkflowValidationIssue["entityType"],
  entityId: string | null,
  message: string,
  suggestedAction: string,
): WorkflowValidationIssue {
  return { code, severity, entityType, entityId, message, suggestedAction };
}

// 發布前結構化驗證（第五節，15 項）。純讀取，不寫入、不修改任何資料。
export async function validateWorkflowVersionForPublish(
  client: Client,
  workflowVersionId: string,
): Promise<{ valid: boolean; issues: WorkflowValidationIssue[] }> {
  const issues: WorkflowValidationIssue[] = [];

  const [stages, transitions, requirements] = await Promise.all([
    client.workflowStage.findMany({ where: { workflowVersionId } }),
    client.workflowTransition.findMany({ where: { workflowVersionId } }),
    client.workflowStageRequirement.findMany({
      where: { workflowStage: { workflowVersionId } },
    }),
  ]);

  // 第 14 項：不得發布空白流程
  if (stages.length === 0) {
    issues.push(
      issue("EMPTY_WORKFLOW", "error", "WorkflowVersion", workflowVersionId, "此版本沒有任何 Stage，不得發布空白流程", "至少新增一個關卡後再嘗試發布"),
    );
    return { valid: false, issues };
  }

  const stageById = new Map(stages.map((s) => [s.id, s]));

  // 第 4 項：防禦性 assert 所有 Transition／Requirement 屬於同一 workflowVersionId
  for (const t of transitions) {
    if (t.workflowVersionId !== workflowVersionId) {
      issues.push(
        issue("CROSS_VERSION_TRANSITION", "error", "WorkflowTransition", t.id, "Transition 不屬於本版本（資料異常）", "請聯絡系統管理員檢查資料完整性"),
      );
    }
  }

  // 第 1 項：isStart 恰好 1 個
  const startStages = stages.filter((s) => s.isStart);
  if (startStages.length !== 1) {
    issues.push(
      issue(
        "START_STAGE_COUNT",
        "error",
        "WorkflowVersion",
        workflowVersionId,
        `isStart 關卡數量為 ${startStages.length}，必須恰好 1 個`,
        "設定唯一一個關卡為起始關卡（isStart=true）",
      ),
    );
  }

  // 第 11 項：isEnd=false 時 terminalOutcome 必須為 null；isEnd=true 時必填且為 COMPLETED/CANCELLED 之一
  for (const s of stages) {
    if (!s.isEnd && s.terminalOutcome !== null) {
      issues.push(
        issue("NON_END_HAS_TERMINAL_OUTCOME", "error", "WorkflowStage", s.id, `關卡「${s.stageKey}」非結束關卡卻設有 terminalOutcome`, "移除此關卡的 terminalOutcome，或改設 isEnd=true"),
      );
    }
    if (s.isEnd && (s.terminalOutcome === null || !isTerminalOutcome(s.terminalOutcome))) {
      issues.push(
        issue("END_STAGE_MISSING_TERMINAL_OUTCOME", "error", "WorkflowStage", s.id, `結束關卡「${s.stageKey}」缺少合法 terminalOutcome（COMPLETED/CANCELLED）`, "為此結束關卡設定 terminalOutcome"),
      );
    }
    if (s.label.trim() === "") {
      issues.push(issue("BLANK_STAGE_LABEL", "error", "WorkflowStage", s.id, `關卡「${s.stageKey}」名稱為空白`, "為此關卡填寫有意義的名稱"));
    }
  }

  // 第 2 項：至少一個 terminalOutcome=COMPLETED 的結束關卡
  const completedStages = stages.filter((s) => s.isEnd && s.terminalOutcome === "COMPLETED");
  if (completedStages.length === 0) {
    issues.push(
      issue("NO_COMPLETED_STAGE", "error", "WorkflowVersion", workflowVersionId, "此版本沒有任何 terminalOutcome=COMPLETED 的結束關卡", "至少新增一個正常完成的結束關卡"),
    );
  }

  // 第 3 項：每個非結束關卡恰好 1 個 FORWARD（DB 已擋 >1，此處查 0 的漏設）
  const forwardByFromStage = new Map<string, (typeof transitions)[number][]>();
  for (const t of transitions) {
    if (t.transitionType !== "FORWARD") continue;
    const list = forwardByFromStage.get(t.fromStageId) ?? [];
    list.push(t);
    forwardByFromStage.set(t.fromStageId, list);
  }
  for (const s of stages) {
    if (s.isEnd) continue;
    const forwards = forwardByFromStage.get(s.id) ?? [];
    if (forwards.length === 0) {
      issues.push(
        issue("NON_END_STAGE_MISSING_FORWARD", "error", "WorkflowStage", s.id, `非結束關卡「${s.stageKey}」沒有任何 FORWARD Transition`, "為此關卡新增一個 FORWARD Transition"),
      );
    } else if (forwards.length > 1) {
      // DB partial unique index 應已擋下，此處為防禦性重查
      issues.push(
        issue("MULTIPLE_FORWARD_FROM_STAGE", "error", "WorkflowStage", s.id, `關卡「${s.stageKey}」有多於 1 個 FORWARD Transition（資料異常）`, "請聯絡系統管理員檢查資料完整性"),
      );
    }
  }

  // FORWARD 主路徑：從唯一 isStart 關卡沿 FORWARD 邊走訪，建立 mainPathIndex；偵測環。
  const mainPathIndex = new Map<string, number>();
  if (startStages.length === 1) {
    let cursor: string | undefined = startStages[0].id;
    let index = 0;
    const guard = stages.length + 1; // 防止意外無窮迴圈（walk 本身已用 mainPathIndex 偵測環，這裡是雙重保險）
    while (cursor && index <= guard) {
      if (mainPathIndex.has(cursor)) {
        issues.push(
          issue("FORWARD_PATH_CYCLE", "error", "WorkflowVersion", workflowVersionId, "FORWARD 主路徑存在環（不允許）", "移除造成環的 FORWARD Transition"),
        );
        break;
      }
      mainPathIndex.set(cursor, index);
      index += 1;
      const currentStage = stageById.get(cursor);
      if (currentStage?.isEnd) break;
      const nextForwards: typeof transitions = forwardByFromStage.get(cursor) ?? [];
      cursor = nextForwards[0]?.toStageId;
    }
  }

  // 第 5 項：可達性——一般非取消 Stage 必須能由起始 Stage 只沿 FORWARD 邊到達；
  // terminalOutcome=CANCELLED 的 Stage 不要求由 FORWARD 到達（由第 10 項獨立驗證）。
  for (const s of stages) {
    if (s.terminalOutcome === "CANCELLED") continue;
    if (!mainPathIndex.has(s.id)) {
      issues.push(
        issue("UNREACHABLE_STAGE", "error", "WorkflowStage", s.id, `關卡「${s.stageKey}」無法由起始關卡只沿 FORWARD 邊到達（孤立關卡）`, "檢查此關卡是否應在 FORWARD 主路徑上，或應移除"),
      );
    }
  }

  // 第 7 項：RETURN 的 toStageId 必須是來源關卡在 FORWARD 主路徑上的祖先，不得指向自己
  for (const t of transitions) {
    if (t.transitionType !== "RETURN") continue;
    if (t.toStageId === t.fromStageId) {
      issues.push(issue("RETURN_TO_SELF", "error", "WorkflowTransition", t.id, "RETURN 不得指向自己", "將 RETURN 目標改為 FORWARD 主路徑上的祖先關卡"));
      continue;
    }
    const fromIndex = mainPathIndex.get(t.fromStageId);
    const toIndex = mainPathIndex.get(t.toStageId);
    if (fromIndex === undefined || toIndex === undefined || !(toIndex < fromIndex)) {
      issues.push(
        issue(
          "RETURN_TARGET_NOT_ANCESTOR",
          "error",
          "WorkflowTransition",
          t.id,
          "RETURN 目標必須是來源關卡在 FORWARD 主路徑上的祖先",
          "將 RETURN 目標改為 FORWARD 主路徑上、序號較小的關卡",
        ),
      );
    }
  }

  // 第 10 項 ＋ 第四節第 6 點：CANCEL 只能指向 terminalOutcome=CANCELLED 的結束關卡；
  // 每個 terminalOutcome=CANCELLED 的結束關卡至少須有一條合法 CANCEL transition 指向，
  // 否則視為未使用的孤立結束關卡。
  const cancelTransitions = transitions.filter((t) => t.transitionType === "CANCEL");
  for (const t of cancelTransitions) {
    const target = stageById.get(t.toStageId);
    if (!target || target.terminalOutcome !== "CANCELLED") {
      issues.push(
        issue("CANCEL_TARGET_NOT_CANCELLED", "error", "WorkflowTransition", t.id, "CANCEL 必須指向 terminalOutcome=CANCELLED 的結束關卡", "將 CANCEL 目標改為 terminalOutcome=CANCELLED 的結束關卡"),
      );
    }
  }
  const cancelledEndStages = stages.filter((s) => s.isEnd && s.terminalOutcome === "CANCELLED");
  for (const s of cancelledEndStages) {
    const hasIncomingCancel = cancelTransitions.some((t) => t.toStageId === s.id);
    if (!hasIncomingCancel) {
      issues.push(
        issue("UNUSED_CANCELLED_STAGE", "error", "WorkflowStage", s.id, `結束關卡「${s.stageKey}」（CANCELLED）沒有任何 CANCEL Transition 指向，屬未使用的孤立結束關卡`, "新增一條 CANCEL Transition 指向此關卡，或移除此關卡"),
      );
    }
  }

  // 第 8 項：有 assignedTeamId 的 Stage，該 Team 必須存在
  const teamIds = [...new Set(stages.map((s) => s.assignedTeamId).filter((id): id is string => !!id))];
  if (teamIds.length > 0) {
    const existingTeams = await client.team.findMany({ where: { id: { in: teamIds } }, select: { id: true } });
    const existingTeamIds = new Set(existingTeams.map((t) => t.id));
    for (const s of stages) {
      if (s.assignedTeamId && !existingTeamIds.has(s.assignedTeamId)) {
        issues.push(
          issue("ASSIGNED_TEAM_NOT_FOUND", "error", "WorkflowStage", s.id, `關卡「${s.stageKey}」的 assignedTeamId 對應的 Team 不存在`, "選擇一個實際存在的 Team，或清空此欄位"),
        );
      }
    }
  }

  // 第 9 項：stageType==="APPROVAL" 必須有合法 approvalType；非 APPROVAL 的 approvalType 必須是 null
  for (const s of stages) {
    if (s.stageType === "APPROVAL") {
      if (!s.approvalType || !isApprovalType(s.approvalType)) {
        issues.push(
          issue("APPROVAL_STAGE_MISSING_TYPE", "error", "WorkflowStage", s.id, `APPROVAL 關卡「${s.stageKey}」缺少合法 approvalType`, "為此關卡設定合法的 approvalType"),
        );
      }
    } else if (s.approvalType !== null) {
      issues.push(
        issue("NON_APPROVAL_STAGE_HAS_TYPE", "error", "WorkflowStage", s.id, `非 APPROVAL 關卡「${s.stageKey}」不得設定 approvalType`, "清空此關卡的 approvalType"),
      );
    }
  }

  // 第 12 項：stageKey／actionKey 唯一性（DB 已保證，防禦性重查）
  const stageKeyCounts = new Map<string, number>();
  for (const s of stages) stageKeyCounts.set(s.stageKey, (stageKeyCounts.get(s.stageKey) ?? 0) + 1);
  for (const [key, count] of stageKeyCounts) {
    if (count > 1) {
      issues.push(
        issue("DUPLICATE_STAGE_KEY", "error", "WorkflowVersion", workflowVersionId, `stageKey「${key}」重複出現 ${count} 次（資料異常）`, "請聯絡系統管理員檢查資料完整性"),
      );
    }
  }
  const actionKeyCounts = new Map<string, number>();
  for (const t of transitions) {
    const compositeKey = `${t.fromStageId}::${t.actionKey}`;
    actionKeyCounts.set(compositeKey, (actionKeyCounts.get(compositeKey) ?? 0) + 1);
  }
  for (const [key, count] of actionKeyCounts) {
    if (count > 1) {
      issues.push(
        issue("DUPLICATE_ACTION_KEY", "error", "WorkflowVersion", workflowVersionId, `同一關卡的 actionKey「${key.split("::")[1]}」重複出現 ${count} 次（資料異常）`, "請聯絡系統管理員檢查資料完整性"),
      );
    }
  }

  // 第 13 項：WorkflowStageRequirement.requirementType 必須在白名單內
  for (const r of requirements) {
    if (!isWorkflowStageRequirementType(r.requirementType)) {
      issues.push(
        issue("INVALID_REQUIREMENT_TYPE", "error", "WorkflowStageRequirement", r.id, `requirementType「${r.requirementType}」不在白名單內`, "改為 REQUIRE_FIELD／REQUIRE_EVIDENCE／REQUIRE_COMMENT 之一"),
      );
    }
  }

  return { valid: issues.every((i) => i.severity !== "error"), issues };
}

export async function getWorkflowVersionOrThrow(client: Client, workflowVersionId: string) {
  const version = await client.workflowVersion.findUnique({ where: { id: workflowVersionId } });
  if (!version) throw new WorkflowNotFoundError(`找不到 WorkflowVersion：${workflowVersionId}`);
  return version;
}
