// M1.5-A 新增：集中式半開區間（[validFrom, validUntil)）判斷模組。
//
// UserSupervisorAssignment 與 ApprovalDelegation 的有效期間統一採此語意：
// - 有效性：validFrom <= now 且（validUntil 為 null，或 now < validUntil）。
// - 重疊：兩區間 [aFrom, aUntil) 與 [bFrom, bUntil) 重疊，若且唯若
//   aFrom < bUntil 且 bFrom < aUntil（null 視為 +Infinity，即「尚未設定終止日」）。
//
// 採半開區間可確保「舊主管於時間 T 終止、新主管於時間 T 生效」不會被誤判為重疊：
// 舊區間 validUntil=T（不含 T），新區間 validFrom=T，兩者交界不重疊。
//
// 所有需要日期比較的服務層（permissions.ts、approvalService.ts 等）一律呼叫本檔案函式，
// 不得自行撰寫日期比較邏輯。

export function isWithinHalfOpenWindow(
  validFrom: Date,
  validUntil: Date | null,
  now: Date = new Date(),
): boolean {
  if (validFrom.getTime() > now.getTime()) return false;
  if (validUntil === null) return true;
  return now.getTime() < validUntil.getTime();
}

export function windowsOverlap(
  aFrom: Date,
  aUntil: Date | null,
  bFrom: Date,
  bUntil: Date | null,
): boolean {
  const aUntilMs = aUntil === null ? Number.POSITIVE_INFINITY : aUntil.getTime();
  const bUntilMs = bUntil === null ? Number.POSITIVE_INFINITY : bUntil.getTime();
  return aFrom.getTime() < bUntilMs && bFrom.getTime() < aUntilMs;
}
