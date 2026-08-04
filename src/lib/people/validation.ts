// C1-B3 新增：People 領域純驗證函式。不存取 DB，只檢查呼叫端輸入本身的形式是否合法。
// 與資料庫現況有關的檢查（例如「email 是否已被使用」「userId 是否存在」）一律留在
// 各 xxxService.ts 的 xxxTx 函式內，於 transaction 中現場查詢。

import { isRoleKey, type RoleKey } from "../constants";
import { PeopleValidationError } from "./types";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function assertReasonCodeProvided(reasonCode: string | undefined | null, issues: string[]): void {
  if (!reasonCode?.trim()) issues.push("reasonCode 不得為空");
}

export function assertValidRoleKey(role: string, issues: string[], fieldLabel = "role"): role is RoleKey {
  if (!isRoleKey(role)) {
    issues.push(`${fieldLabel} 不在合法角色值域：${role}`);
    return false;
  }
  return true;
}

export function assertValidProfileFields(
  fields: { name?: string; email?: string; department?: string },
  issues: string[],
): void {
  if (fields.name !== undefined && !fields.name.trim()) {
    issues.push("name 不得為空白字串");
  }
  if (fields.email !== undefined) {
    if (!fields.email.trim()) {
      issues.push("email 不得為空");
    } else if (!EMAIL_PATTERN.test(fields.email)) {
      issues.push("email 格式不正確");
    }
  }
}

// 統一的「驗證失敗即拋出」入口，issues 陣列由呼叫端各自組裝後傳入。
export function throwIfInvalid(issues: string[]): void {
  if (issues.length > 0) throw new PeopleValidationError(issues);
}
