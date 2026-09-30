import type { AiSuggestion } from "@prisma/client";
import type { IssueWithRelations } from "@/lib/types";
import { evaluateGateRules } from "@/lib/rules";
import { fieldMap, formatDate } from "@/lib/utils";
import {
  displayBlockReason,
  displayEnvironment,
  displayIssueType,
  displayNextStep,
  displayRiskLevel,
  displayRole,
  displayWorkflowStatus
} from "@/lib/i18n";

export const AI_SUGGESTION_TYPES = [
  "Generate Problem Summary",
  "Suggest Impact Scope",
  "Draft RCA",
  "Suggest Corrective Action",
  "Suggest Preventive Action",
  "Suggest Next Step",
  "Check Missing Evidence"
] as const;

export type AiSuggestionType = (typeof AI_SUGGESTION_TYPES)[number];

export function generateMockAiSuggestion(
  issue: IssueWithRelations,
  suggestionType: AiSuggestionType
): Pick<AiSuggestion, "suggestionType" | "prompt" | "output"> {
  const values = fieldMap(issue.fieldValues);
  const gate = evaluateGateRules(issue);
  const summaryBase = `${issue.issueKey} / ${displayIssueType(issue.issueType)} / ${issue.systemName} / ${displayEnvironment(issue.environment)}`;
  const prompt = `${suggestionType} for ${summaryBase}`;

  const outputs: Record<AiSuggestionType, string> = {
    "Generate Problem Summary": [
      "問題摘要草稿",
      `- 範圍：${issue.systemName}，環境為 ${displayEnvironment(issue.environment)}。`,
      `- 目前流程：${displayWorkflowStatus(issue.workflowStatus)}，風險等級 ${displayRiskLevel(issue.riskLevel)}，優先級 ${issue.priority}。`,
      `- 治理關注點：${issue.description || "仍待負責人補充說明。"}`,
      `- 到期日：${formatDate(issue.dueDate)}。`
    ].join("\n"),
    "Suggest Impact Scope": [
      "影響範圍草稿",
      `- 業務流程：確認 ${issue.systemName} 的受影響服務負責人與上下游流程。`,
      "- 技術面：檢視部署、監控、權限與資料路徑。",
      "- 使用者面：盤點生產使用者、客服影響與下游消費者。",
      `- 既有輸入：${values.impactScope || values.impactedServices || "尚未提供詳細影響範圍。"}`
    ].join("\n"),
    "Draft RCA": [
      "RCA 草稿",
      `1. 事件：${issue.title}。`,
      `2. 直接原因：${values.rootCauseSummary || "待 RD 與資安確認。"}`,
      "3. 促成因素：佐證不足、驗證未完成或流程交接延遲。",
      "4. 偵測落差：比對告警時間、首次回應與負責人升級路徑。",
      "5. 驗證要求：結案前需補齊佐證連結與結案留言。"
    ].join("\n"),
    "Suggest Corrective Action": [
      "矯正措施建議",
      "- 指派單一負責人處理立即修復與驗證佐證。",
      "- 在生產確認前補上回復或隔離步驟。",
      "- 更新議題中的測試結果、負責人確認與受影響元件清單。"
    ].join("\n"),
    "Suggest Preventive Action": [
      "預防措施建議",
      "- 在相關流程狀態增加必要檢核項目。",
      `- 強化 ${issue.systemName} 的監控或告警路由。`,
      "- 評估是否需要關聯風險例外或 RCA 以保留稽核軌跡。"
    ].join("\n"),
    "Suggest Next Step": [
      "下一步建議",
      gate.passed
        ? `- 關卡檢查通過。${displayNextStep(gate.nextStep)}`
        : `- 關卡檢查未通過：${displayBlockReason([
            ...gate.missingFields,
            ...gate.missingEvidence,
            ...gate.blockReasons
          ].join("; "))}。`,
      `- 等候角色：${displayRole(issue.waitingRole)}。`,
      `- 負責人：${issue.ownerName}（${displayRole(issue.ownerRole)}）。`
    ].join("\n"),
    "Check Missing Evidence": [
      "缺少佐證檢查",
      issue.evidence.length > 0
        ? `- 已有佐證：${issue.evidence.map((item) => item.title).join("、")}。`
        : "- 尚無佐證連結。",
      gate.missingEvidence.length > 0
        ? `- 結案前必要項目：${displayBlockReason(gate.missingEvidence.join("; "))}。`
        : "- 目前沒有佐證關卡阻擋。",
      "- 建議佐證：測試結果、核准紀錄、部署或監控證明、結案留言。"
    ].join("\n")
  };

  return {
    suggestionType,
    prompt,
    output: outputs[suggestionType]
  };
}
