# DMS Governance Tracker

本專案是一套可本機執行的 MVP 版內部治理流程管理系統，用於追蹤 DMS 相關的 Hotfix、Incident、RCA、Risk Exception、QA Verification、Change / Release、Monitoring Inventory、Backup / Recovery Test 等流程項目。

## 環境需求

- Node.js 18.20.4 或 Next.js 15 支援的較新版本
- npm

## 安裝

```bash
npm install
```

## 資料庫初始化

本機 MVP 使用 Prisma Client + SQLite。

```bash
npm run db:setup
```

這個指令會依序執行：

1. `prisma generate`
2. `tsx prisma/setup.ts`
3. `tsx prisma/seed.ts`

`prisma/setup.ts` 是為 Windows / OneDrive 環境準備的 deterministic SQLite bootstrap，避免 `prisma migrate dev` 在部分環境出現空白 schema-engine 錯誤。專案仍保留傳統 migration SQL：`prisma/migrations/20260718000000_init/migration.sql`。

## 執行

```bash
npm run dev
```

`npm run dev` 會以 Next.js Turbopack 啟動，這在 Windows / OneDrive 本機環境比預設 webpack dev server 穩定。

開啟：

```text
http://localhost:3000/dashboard
```

## 常用指令

```bash
npm run db:setup       # 產生 Prisma Client、建立 SQLite tables、載入種子資料
npm run db:reset       # 重建本機 SQLite schema 並重新載入種子資料
npm run prisma:seed    # 重新載入 reference 與 issue seed data
npm run lint           # ESLint 檢查
npm run build          # Production build
```

## MVP 範圍

已實作頁面：

- `/dashboard`：儀表板
- `/issues`：議題清單
- `/issues/new`：新增議題
- `/issues/[id]`：議題詳細頁
- `/admin/workflows`：流程設定
- `/admin/form-templates`：表單範本

已實作能力：

- SQLite + Prisma 資料模型
- 8 種治理議題類型
- 依議題類型切換的動態欄位
- 流程狀態進度顯示與轉換
- `calculateStatusLight(issue)` 燈號規則
- `evaluateGateRules(issue)` 關卡阻擋規則
- 佐證連結、留言、稽核紀錄
- cookie-based 角色切換模擬
- Mock AI Assistant，並保留可替換為真實 AI API 的 service layer

## 種子資料

Seed data 目前包含 19 筆議題，覆蓋 Red / Yellow / Blue / Green / Gray 五種燈號情境，例如：

- QA 失敗的 Hotfix
- Critical 監控告警未回應
- 高等級 Incident 缺少 RCA
- 等待 DMS 管理者核准的風險例外
- 備份結果失敗
- 已結案且佐證完整的項目

## Mock AI

目前 AI 助理為模擬輸出，不呼叫外部 AI API。畫面會明確提示：

```text
AI 建議為模擬輸出，請由流程負責人確認後再採用。
```

未來若要接 OpenAI 或其他供應商，可從 `lib/ai.ts` 的 `generateMockAiSuggestion` 替換為 provider adapter。

## MVP 限制

- 尚未實作正式登入與授權；目前以 cookie 模擬角色。
- 佐證資料以 URL 形式儲存，尚未支援檔案上傳。
- 流程與表單範本是靜態定義，尚未提供完整 BPMN 或 low-code workflow editor。
- AI 目前是 mock service，尚未串接真實模型。
- 本機使用 SQLite；Prisma schema 已保留未來搬到 PostgreSQL 的資料模型方向。
