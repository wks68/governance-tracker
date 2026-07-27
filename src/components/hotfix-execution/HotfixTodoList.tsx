// Hotfix 操作畫面收斂新增：目前待完成事項（需求四）。取代舊有「關卡卡控檢查」畫面，
// 一律使用使用者看得懂的用語，不顯示 gate／requirement／technical field key 等技術詞彙。

import type { HotfixTodoItem } from "@/lib/hotfix-ui/runtimeView";

export default function HotfixTodoList({ items, nextActionLabel }: { items: HotfixTodoItem[]; nextActionLabel: string | null }) {
  if (items.length === 0) {
    return <p className="text-sm text-gray-500">目前沒有待完成事項，可以進行下一步。</p>;
  }
  return (
    <div className="space-y-2">
      <p className="text-sm text-gray-700">
        完成下列 {items.length} 項後{nextActionLabel ? `，可「${nextActionLabel}」` : ""}：
      </p>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i}>
            {item.anchor ? (
              <a href={`#${item.anchor}`} className="flex items-start gap-2 text-sm text-gray-700 hover:text-primary hover:underline">
                <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gov-yellow" />
                {item.text}
              </a>
            ) : (
              <div className="flex items-start gap-2 text-sm text-gray-700">
                <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gov-yellow" />
                {item.text}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
