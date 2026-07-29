// 工單編號持久化計數器——正式取號路徑（線上建立工單專用）。
//
// 信任邊界：本檔案是「工單編號永不重複、永不倒退」的唯一正式來源。呼叫端只能傳入
// issueType，絕不接受呼叫端指定或覆寫 issueKey／sequence 數值。取號一律在呼叫端提供的
// 既有 transaction（tx）內以 Prisma 的 { increment: 1 } 編譯成單一原子 UPDATE 陳述式，
// 不得先 read lastValue 再由應用程式計算後 update（那樣在兩個並行 transaction 之間會有
// read-modify-write 競態）。
//
// Fail closed：IssueKeySequence 對應 issueType 的列不存在時，直接視為設定錯誤而拒絕
// （IssueKeySequenceNotConfiguredError），不得以 upsert 在正常 runtime 建立路徑上「順便」
// 生出一列——正常 runtime 只允許遞增既有列，建立列的動作只交給 Migration 初始化與
// synchronizationService（見同目錄 synchronizationService.ts），避免 race 出重複列或
// 讓程式碼誤以為「沒設定」等同「從 0 開始」。

import { Prisma } from "@prisma/client";
import { ISSUE_TYPE_PREFIX } from "../constants";

type Tx = Prisma.TransactionClient;

export class InvalidIssueTypeError extends Error {
  constructor(public readonly issueType: string) {
    super(`不合法的工單類型「${issueType}」，無法配發編號`);
    this.name = "InvalidIssueTypeError";
  }
}

export class IssueKeySequenceNotConfiguredError extends Error {
  constructor(public readonly issueType: string) {
    super(`工單類型「${issueType}」尚未設定編號計數器，暫時無法建立工單。請聯絡系統管理員完成設定。`);
    this.name = "IssueKeySequenceNotConfiguredError";
  }
}

function isRecordNotFoundError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "P2025";
}

// 是否為 SQLite／Prisma 可判斷的暫時性交易衝突（僅供呼叫端決定是否重試整個建立
// transaction，本檔案本身不重試——重試邊界必須涵蓋「驗證＋取號＋建立 Issue」整組，
// 見 src/lib/issueCreation.ts）。P2034 是 Prisma 官方定義的 "Transaction failed due to a
// write conflict or a deadlock" 代碼，涵蓋 SQLite busy/locked 等暫時性衝突；不得把
// Unauthorized／驗證錯誤／業務規則拒絕誤判為可重試。
export function isTransientTransactionConflict(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "P2034";
}

// 在既有 transaction 內原子遞增並回傳新配發的 issueKey。呼叫端必須把本函式呼叫與
// Issue 建立放在同一個 tx 內——任一步失敗，整個 transaction（含本次遞增）一起回滾，
// 該號碼視為從未配發，下一次交易可再次取得；一旦本函式所在的 transaction 成功
// commit，該號碼即永久配發，不得因後續刪除 Issue 而回收或重新配發。
export async function allocateNextIssueKey(tx: Tx, issueType: string): Promise<string> {
  const prefix = ISSUE_TYPE_PREFIX[issueType];
  if (!prefix) {
    throw new InvalidIssueTypeError(issueType);
  }

  let updated: { lastValue: number };
  try {
    updated = await tx.issueKeySequence.update({
      where: { issueType },
      data: { lastValue: { increment: 1 } },
    });
  } catch (err) {
    if (isRecordNotFoundError(err)) {
      throw new IssueKeySequenceNotConfiguredError(issueType);
    }
    throw err;
  }

  return `${prefix}-${String(updated.lastValue).padStart(4, "0")}`;
}
