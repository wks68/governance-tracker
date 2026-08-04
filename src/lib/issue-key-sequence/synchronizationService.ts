// 工單編號持久化計數器——同步／維護路徑。
//
// 用途限定（不得用於線上建立工單 runtime 路徑，那條路徑只允許 allocationService 的原子
// { increment: 1 }）：
//   1. Migration 驗證腳本（確認既有 DB 升級後的計數器與正式歷史高水位一致）。
//   2. prisma/seed.ts（Fresh DB 在 Migration 套用當下 Issue 表尚無資料，計數器只能先以
//      0／已知歷史高水位建立；seed 灌入固定 Issue 後必須呼叫本檔案把計數器補到與
//      seed 資料一致）。
//   3. Preview fixture 腳本（若直接寫入固定 issueKey、不經過 allocationService，之後若
//      同一支腳本改用真正的建立服務層，必須先同步，否則會撞號或倒退）。
//   4. 管理維護（人工排除設定錯誤）。
//
// 本檔案任何函式都只會把 lastValue 往上調，絕不下修——即使重複執行（seed 重跑、
// Migration 驗證重跑）也一樣，天生冪等。

import { Prisma, PrismaClient } from "@prisma/client";
import { ISSUE_TYPE_PREFIX } from "../constants";

type Client = PrismaClient | Prisma.TransactionClient;

// 已知歷史高水位：即使目前存活 Issue 已無對應列（例如已被永久刪除），此編號仍確定
// 曾被使用過，不得再次配發。資料來源與佐證見
// prisma/migrations/20260729024352_add_issue_key_sequence/migration.sql 內的說明註解
// （HOTFIX-0004 曾於正式 dev.db 建立後受控刪除，scripts/m2_b-verify.ts 的
// [MIG1-0]/[MIG1-0b] 長期將此列為基準事實）。此常數與該 Migration SQL 內硬編碼的初始值
// 必須保持一致；若日後發現新的已刪除歷史編號，兩處都要同步更新，且要新增對應的
// targeted verify 佐證來源。
export const KNOWN_HISTORICAL_FLOORS: Readonly<Record<string, number>> = {
  Hotfix: 4,
};

function parseNumericSuffix(issueKey: string): number {
  const idx = issueKey.indexOf("-");
  if (idx === -1) return 0;
  const n = parseInt(issueKey.slice(idx + 1), 10);
  return Number.isFinite(n) ? n : 0;
}

// 單一 issueType 的目標值＝max(目前存活 Issue 數字後綴最大值, sequence 既有 lastValue,
// 已知歷史最低高水位)。回傳 null 代表不需要變動（已經是目標值，維持冪等、不多寫）。
async function computeTargetForIssueType(client: Client, issueType: string): Promise<number> {
  const rows = await client.issue.findMany({ where: { issueType }, select: { issueKey: true } });
  const liveMax = rows.reduce((max, r) => Math.max(max, parseNumericSuffix(r.issueKey)), 0);
  const floor = KNOWN_HISTORICAL_FLOORS[issueType] ?? 0;
  const existing = await client.issueKeySequence.findUnique({ where: { issueType } });
  return Math.max(liveMax, floor, existing?.lastValue ?? 0);
}

// 針對單一 issueType 同步（供只需處理一種類型時使用，例如 Preview fixture 在第一次改用
// 真正建立服務層之前）。
export async function synchronizeIssueKeySequenceForType(client: Client, issueType: string): Promise<void> {
  const target = await computeTargetForIssueType(client, issueType);
  const existing = await client.issueKeySequence.findUnique({ where: { issueType } });
  if (existing && existing.lastValue === target) return; // 已是目標值，冪等不動作
  await client.issueKeySequence.upsert({
    where: { issueType },
    create: { issueType, lastValue: target },
    update: { lastValue: target },
  });
}

// 依 ISSUE_TYPE_PREFIX 列出的全部已知 issueType 逐一同步。
export async function synchronizeIssueKeySequencesFromExistingIssues(client: Client): Promise<void> {
  for (const issueType of Object.keys(ISSUE_TYPE_PREFIX)) {
    await synchronizeIssueKeySequenceForType(client, issueType);
  }
}
