// M1.5-C1-C 新增：顯示 ActionResult 錯誤／成功訊息的共用小元件，供人員與 Team 管理的
// 各個 Drawer／表單共用同一種顯示樣式，不在各元件各自組一套錯誤顯示 markup。
export function ActionErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="mb-3 rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-xs text-danger-text">{message}</p>;
}

export function ActionSuccessText({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="mb-3 rounded-md border border-success-border bg-success-bg px-3 py-2 text-xs text-success-text">{message}</p>;
}
