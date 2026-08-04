"use client";

// M2-B 新增：目前關卡 Requirement 達成狀態，含 REQUIRE_FIELD 的就地填寫（沿用
// submitStageFieldValue，只接受目前關卡實際宣告的欄位鍵，不是任意寫入）。
//
// REQUIRE_EVIDENCE／REQUIRE_COMMENT 的實際填寫仍透過既有頁面區塊（佐證資料／留言，
// 見 src/app/issues/[id]/page.tsx 既有的 EvidenceList／CommentList）完成——那兩個既有
// Server Action（addEvidenceAction／addCommentAction）本就不依賴 issue.workflowStatus，
// 對新模型 Issue 一樣正確可用，本面板不重建第二套佐證／留言輸入介面。

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionErrorText } from "@/components/ActionResultBanner";
import { submitStageFieldValueAction } from "@/app/issues/[id]/workflow-execution-actions";

export interface StageRequirementItem {
  requirementId: string;
  requirementType: string;
  targetKey: string;
  satisfied: boolean;
  message: string;
}

const REQUIREMENT_TYPE_LABEL: Record<string, string> = {
  REQUIRE_FIELD: "欄位",
  REQUIRE_EVIDENCE: "佐證",
  REQUIRE_COMMENT: "留言",
};

function FieldInlineForm({ issueId, fieldKey }: { issueId: string; fieldKey: string }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData();
    fd.set("issueId", issueId);
    fd.set("fieldKey", fieldKey);
    fd.set("fieldValue", value);
    startTransition(async () => {
      const result = await submitStageFieldValueAction(fd);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setValue("");
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="mt-1 flex items-center gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={`請輸入「${fieldKey}」`}
        disabled={isPending}
        className="w-48 rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-primary focus:outline-none"
      />
      <button
        type="submit"
        disabled={isPending || !value.trim()}
        className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isPending ? "送出中…" : "填寫"}
      </button>
      {error && <ActionErrorText message={error} />}
    </form>
  );
}

export default function StageRequirementsPanel({ issueId, requirements }: { issueId: string; requirements: StageRequirementItem[] }) {
  if (requirements.length === 0) {
    return <p className="text-xs text-gray-400">此關卡沒有設定額外的完成條件。</p>;
  }
  return (
    <ul className="space-y-2">
      {requirements.map((r) => (
        <li key={r.requirementId} className="flex items-start gap-2 text-sm">
          <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${r.satisfied ? "bg-gov-green" : "bg-gov-yellow"}`} />
          <div>
            <div>
              <span className="mr-1.5 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">{REQUIREMENT_TYPE_LABEL[r.requirementType] ?? r.requirementType}</span>
              <span className={r.satisfied ? "text-gray-600" : "font-medium text-warning-text"}>{r.message}</span>
            </div>
            {!r.satisfied && r.requirementType === "REQUIRE_FIELD" && <FieldInlineForm issueId={issueId} fieldKey={r.targetKey} />}
          </div>
        </li>
      ))}
    </ul>
  );
}
