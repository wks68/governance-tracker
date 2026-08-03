import Tooltip from "@/components/ui/Tooltip";

const CONTENT = `風險等級判定

高
影響主要服務、營運流程、資料正確性或資安風險。

中
影響部分功能或特定使用者。

低
影響有限，但仍需安排修正。`;

export default function RiskLevelHelp() {
  return <span className="ml-1 inline-flex align-middle"><Tooltip label="查看風險等級說明" content={CONTENT} /></span>;
}
