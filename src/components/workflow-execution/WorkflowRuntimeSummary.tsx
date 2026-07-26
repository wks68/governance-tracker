// M2-B 新增：Workflow 執行狀態摘要（唯讀顯示）。純 Server Component，資料完全由呼叫端
// （Issue 詳情頁）透過 getIssueWorkflowRuntime 現場查詢後傳入，本檔案不查詢 Prisma、
// 不自行判斷任何執行規則。

export interface WorkflowRuntimeSummaryProps {
  definitionName: string;
  versionNo: number;
  versionStatus: string;
  currentStageLabel: string;
  currentStageType: string;
  assignedTeamName: string | null;
}

const VERSION_STATUS_LABEL: Record<string, string> = { DRAFT: "草稿", PUBLISHED: "已發布", ARCHIVED: "已封存" };

export default function WorkflowRuntimeSummary({
  definitionName,
  versionNo,
  versionStatus,
  currentStageLabel,
  currentStageType,
  assignedTeamName,
}: WorkflowRuntimeSummaryProps) {
  return (
    <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
      <div>
        <div className="text-xs text-gray-400">流程定義</div>
        <div className="font-medium text-gray-800">{definitionName}</div>
      </div>
      <div>
        <div className="text-xs text-gray-400">版本</div>
        <div className="font-medium text-gray-800">
          v{versionNo}
          <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">{VERSION_STATUS_LABEL[versionStatus] ?? versionStatus}</span>
        </div>
      </div>
      <div>
        <div className="text-xs text-gray-400">目前關卡</div>
        <div className="font-medium text-gray-800">
          {currentStageLabel}
          <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">{currentStageType}</span>
        </div>
      </div>
      <div>
        <div className="text-xs text-gray-400">目前處理團隊</div>
        <div className="font-medium text-gray-800">{assignedTeamName ?? "（尚未指派）"}</div>
      </div>
    </div>
  );
}
