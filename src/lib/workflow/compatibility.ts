// M2-A 新增：workflowStatus 相容層。
//
// 單一事實來源原則（Plan M2 章節六）：
// - workflowVersionId／currentWorkflowStageId 是新流程 Issue 的唯一權威來源。
// - workflowStatus 只是同步快取，供舊版 Dashboard／報表過渡期顯示，
//   新流程的授權、可用動作、transition 判斷「一律不得」讀取 workflowStatus。
// - 本檔案只提供「這張 Issue 是不是新版流程」的單一判斷函式，避免呼叫端各自
//   散落 `issue.workflowVersionId !== null` 這種判斷式、日後改名或改語意時到處漏改。
//
// M2-A 尚未實作執行引擎（M2-B 範圍），本檔案目前不含任何寫入或狀態同步邏輯，
// 只提供 M2-A3 UI／未來 M2-B 都能共用的唯讀判斷與查詢。

import { prisma } from "../prisma";

export interface IssueWorkflowLike {
  workflowVersionId: string | null;
}

// 唯一權威判斷：是否為新版（版本化）Workflow Issue。不得在別處另行 inline 判斷。
export function isIssueOnVersionedWorkflow(issue: IssueWorkflowLike): boolean {
  return issue.workflowVersionId !== null;
}

// 供 M2-A3 管理 UI／未來 Issue 建立流程查詢：某 issueType 目前是否已有可供新 Issue
// 選用的已發布版本（所屬 Definition 必須 isActive=true）。純唯讀，不做任何選用或綁定。
export async function listSelectablePublishedVersionsForIssueType(issueType: string) {
  return prisma.workflowVersion.findMany({
    where: {
      status: "PUBLISHED",
      workflowDefinition: { issueType, isActive: true },
    },
    orderBy: { versionNo: "desc" },
    include: { workflowDefinition: true },
  });
}
