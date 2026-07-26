// Fail-closed 共用保護：任何會寫入 fixture（INSERT／DELETE）的 verify script 必須將本檔
// 作為檔案最上方「第一個 import」（side-effect import，例如
// `import "./lib/assertSafeTestDatabase";`），且該行必須排在其他所有 import 之前
// （包含間接 import src/lib/prisma.ts 的模組，例如 approvalService.ts／permissions.ts）。
//
// 原因：`@prisma/client` 在被 import 時會以自身的 dotenv 邏輯自動讀取 .env 並填入
// process.env.DATABASE_URL——即使呼叫端從未在 shell 顯式 export 這個變數。若本檔不是
// 檔案內第一個 import，等到本檔的檢查邏輯執行時，process.env.DATABASE_URL 可能早已
// 被 Prisma 悄悄從 .env 填成正式 "file:./dev.db"，導致「未顯式設定」的情況被誤判為
// 「已設定」。ES module／CommonJS 的 import 一律依檔案內原始順序、逐一完整求值
// （前一個 import 的整個模組圖求值完畢才會開始下一個），因此只要本檔是第一個
// import，就保證能在任何會觸發 Prisma dotenv 自動載入的模組被載入前完成檢查，
// 檢查失敗時可用 process.exit(1) 阻止後續 import 被求值，不寫入任何資料。
//
// 規則（不符合任一項一律 process.exit(1)，不得繼續）：
// 1. DATABASE_URL 必須由呼叫端顯式設定（不得為 undefined／空字串）。
// 2. 必須是 `file:` 開頭的 SQLite URL。
// 3. 依 Prisma 對 schema.prisma 內相對路徑的解析慣例（相對於 prisma/ 目錄）解出絕對路徑。
// 4. 解析後路徑必須存在且為一般檔案。
// 5. 以 fs.realpathSync 解開 symlink 後，不得等於 prisma/dev.db 的 realpath。
// 6. 額外以 device+inode 比對，防止路徑字串不同但實際上是同一實體檔案（hardlink）。
// 7. 不得落在 /home/codespace/.claude/backups/ 備份目錄之下。

import * as fs from "node:fs";
import * as path from "node:path";

const PRISMA_DIR = path.resolve(__dirname, "..", "..", "prisma");
const FORBIDDEN_DEV_DB = path.join(PRISMA_DIR, "dev.db");
const FORBIDDEN_BACKUP_DIR = path.resolve("/home/codespace/.claude/backups");

function refuse(reason: string): never {
  console.error("拒絕執行：Verify 必須明確指定專用測試資料庫，不得連線至 prisma/dev.db。");
  console.error(`  原因：${reason}`);
  process.exit(1);
}

function main(): void {
  const rawUrl = process.env.DATABASE_URL;

  if (!rawUrl || rawUrl.trim() === "") {
    refuse("未顯式設定 DATABASE_URL（不得讀取 .env 後默認使用正式 dev.db）");
  }

  if (!rawUrl.startsWith("file:")) {
    refuse(`僅允許 file: 開頭的 SQLite URL，收到：${rawUrl}`);
  }

  const rawPath = rawUrl.slice("file:".length);
  const resolvedPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(PRISMA_DIR, rawPath);

  let realResolved: string;
  try {
    realResolved = fs.realpathSync(resolvedPath);
  } catch {
    refuse(`DATABASE_URL 解析後的路徑不存在或無法解析：${resolvedPath}`);
    return;
  }

  let resolvedStat: fs.Stats;
  try {
    resolvedStat = fs.statSync(realResolved);
  } catch {
    refuse(`DATABASE_URL 解析後的路徑無法讀取狀態：${realResolved}`);
    return;
  }
  if (!resolvedStat.isFile()) {
    refuse(`DATABASE_URL 解析後的路徑不是檔案：${realResolved}`);
  }

  if (realResolved.startsWith(FORBIDDEN_BACKUP_DIR + path.sep) || realResolved === FORBIDDEN_BACKUP_DIR) {
    refuse(`DATABASE_URL 不得指向備份目錄：${realResolved}`);
  }

  let devDbStat: fs.Stats | null = null;
  let realDevDb: string | null = null;
  try {
    realDevDb = fs.realpathSync(FORBIDDEN_DEV_DB);
    devDbStat = fs.statSync(realDevDb);
  } catch {
    // prisma/dev.db 若不存在，仍以字串路徑本身作為比對基準
    realDevDb = FORBIDDEN_DEV_DB;
  }

  if (realResolved === realDevDb) {
    refuse(`DATABASE_URL 解析後（含 symlink）指向正式 prisma/dev.db：${realResolved}`);
  }

  if (devDbStat && devDbStat.dev === resolvedStat.dev && devDbStat.ino === resolvedStat.ino) {
    refuse(`DATABASE_URL 解析後的檔案與正式 prisma/dev.db 為同一實體檔案（相同 device/inode）：${realResolved}`);
  }

  console.log(`[assertSafeTestDatabase] 通過：DATABASE_URL 指向專用測試資料庫 ${realResolved}`);
}

main();
