export const ACTION_ERROR_TOAST_DURATION_MS = 7_000;
export const ACTION_ERROR_TOAST_FADE_MS = 400;
export const ACTION_ERROR_TOAST_DEDUPE_MS = 4_000;
export const ACTION_ERROR_TOAST_LIMIT = 3;

export const UNKNOWN_ACTION_ERROR_TITLE = "操作失敗";
export const UNKNOWN_ACTION_ERROR_MESSAGE = "系統暫時無法完成此操作，請稍後再試。";

export interface ActionErrorInput {
  code?: string | null;
  message?: string | null;
  title?: string;
  itemKey?: string;
}

export interface MappedActionError {
  code: string;
  title: string;
  description: string;
  missingSupervisor: boolean;
}

const TECHNICAL_DETAIL =
  /(?:prisma|sql(?:ite)?|node_modules|\/src\/|\\src\\|\.tsx?:\d+|stack trace|database_url|unique constraint|foreign key|\bat\s+[\w.$<>]+\s*\()/i;

export function mapActionErrorMessage(input: ActionErrorInput): MappedActionError {
  const rawCode = input.code?.trim() || "";
  const rawMessage = input.message?.trim() || "";
  const missingSupervisor =
    /直屬主管/.test(rawMessage) && /(?:未設定|尚未設定|找不到|缺少|不存在|無法解析)/.test(rawMessage);

  if (missingSupervisor) {
    return {
      code: rawCode || "MISSING_SUPERVISOR",
      title: "無法送出",
      description: "尚未設定直屬主管，請先完成權責設定後再試一次。",
      missingSupervisor: true,
    };
  }

  if (!rawMessage || rawCode === "UNKNOWN_ERROR" || TECHNICAL_DETAIL.test(rawMessage)) {
    return {
      code: rawCode || "UNKNOWN_ERROR",
      title: UNKNOWN_ACTION_ERROR_TITLE,
      description: UNKNOWN_ACTION_ERROR_MESSAGE,
      missingSupervisor: false,
    };
  }

  return {
    code: rawCode || inferActionErrorCode(rawMessage),
    title: input.title?.trim() || inferActionErrorTitle(rawMessage),
    description: rawMessage,
    missingSupervisor: false,
  };
}

function inferActionErrorCode(message: string): string {
  if (/(?:無權限|權限不足|不得操作|無法操作)/.test(message)) return "ACCESS_DENIED";
  if (/(?:指派|重新指派)/.test(message)) return "ASSIGNMENT_FAILED";
  if (/(?:核准|簽核)/.test(message)) return "APPROVAL_FAILED";
  if (/(?:退回|發回)/.test(message)) return "RETURN_FAILED";
  if (/(?:結案|關閉)/.test(message)) return "CLOSE_FAILED";
  if (/(?:刪除)/.test(message)) return "DELETE_FAILED";
  if (/(?:建立|新增)/.test(message)) return "CREATE_FAILED";
  if (/(?:儲存|保存)/.test(message)) return "SAVE_FAILED";
  return "ACTION_FAILED";
}

function inferActionErrorTitle(message: string): string {
  if (/(?:無權限|權限不足|不得操作|無法操作)/.test(message)) return "無權限操作";
  if (/(?:重新指派|指派)/.test(message)) return "指派失敗";
  if (/(?:核准|簽核)/.test(message)) return "核准失敗";
  if (/(?:退回|發回)/.test(message)) return "退回失敗";
  if (/(?:結案|關閉)/.test(message)) return "結案失敗";
  if (/(?:刪除)/.test(message)) return "刪除失敗";
  if (/(?:建立|新增)/.test(message)) return "建立失敗";
  if (/(?:儲存|保存)/.test(message)) return "儲存失敗";
  return UNKNOWN_ACTION_ERROR_TITLE;
}
