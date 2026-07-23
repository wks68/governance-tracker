"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AI_SUGGESTION_LABELS, AiSuggestionType } from "@/lib/mockAi";
import { runAiAction } from "@/lib/actions";

interface AiSuggestionItem {
  id: string;
  suggestionType: string;
  output: string;
  createdAt: string;
}

const BUTTONS: AiSuggestionType[] = [
  "ProblemSummary",
  "ImpactScope",
  "RcaDraft",
  "CorrectiveAction",
  "PreventiveAction",
  "RdSelfTestItems",
  "NextStep",
  "EvidenceGap",
];

export default function AiAssistantPanel({ issueId, suggestions }: { issueId: string; suggestions: AiSuggestionItem[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingType, setPendingType] = useState<string | null>(null);

  function run(type: AiSuggestionType) {
    setPendingType(type);
    startTransition(async () => {
      await runAiAction(issueId, type);
      router.refresh();
      setPendingType(null);
    });
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
        AI 建議僅供參考，需由權責人員確認後採用。
      </div>

      <div className="flex flex-wrap gap-2">
        {BUTTONS.map((type) => (
          <button
            key={type}
            onClick={() => run(type)}
            disabled={isPending}
            className="rounded-md border border-indigo-200 bg-white px-2.5 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
          >
            {isPending && pendingType === type ? "產生中..." : AI_SUGGESTION_LABELS[type]}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {suggestions.length === 0 ? (
          <p className="text-sm text-gray-400">尚未產生 AI 輔助建議。</p>
        ) : (
          suggestions
            .slice()
            .reverse()
            .map((s) => (
              <div key={s.id} className="rounded-md border border-indigo-100 bg-indigo-50/40 p-3 text-sm">
                <div className="flex items-center justify-between text-xs text-indigo-600">
                  <span className="font-medium">{AI_SUGGESTION_LABELS[s.suggestionType as AiSuggestionType] ?? s.suggestionType}</span>
                  <span>{new Date(s.createdAt).toLocaleString("zh-TW")}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-gray-800">{s.output}</p>
              </div>
            ))
        )}
      </div>
    </div>
  );
}
