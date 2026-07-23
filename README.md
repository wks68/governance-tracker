# DMS Governance Tracker

DMS Governance Tracker 是一套可本機執行的 MVP 版內部治理流程管理系統，模擬類 Jira 的工作單管理介面，
用於管理 Hotfix、Incident、RCA、Risk Exception、QA Verification、Change / Release、
Monitoring Inventory、Backup / Recovery Test 等 DMS 資安治理工作項目。

本專案為 **MVP（最小可行產品）**，目標是讓團隊能夠快速在本機啟動、操作並看到完整的治理流程效果，
因此刻意未實作完整的低代碼平台、BPMN 流程編輯器或複雜的帳號權限系統。

---

## 一、安裝方式

### 前置需求

- Node.js 18 以上版本（建議 20 或 22 LTS）
- npm

### 安裝步驟

```bash
# 1. 進入專案資料夾
cd dms-governance-tracker

# 2. 安裝套件
npm install

# 3. 產生 Prisma Client
npm run db:generate

# 4. 建立 SQLite 資料庫與資料表（會依 prisma/schema.prisma 建立 dev.db）
npm run db:migrate
```

> `npm run db:migrate` 首次執行時會要求輸入 migration 名稱，直接按 Enter 使用預設值即可。
> 執行過程需要下載 Prisma 對應平台的查詢引擎，請確保本機可連上一般網際網路（不需要額外白名單設定）。

---

## 二、啟動方式

```bash
npm run dev
```

啟動後開啟瀏覽器造訪：<http://localhost:3000>

首頁會自動導向 `/dashboard`（治理儀表板）。

---

## 三、建立 Seed Data（示範資料）

```bash
npm run db:seed
```

執行後會清空並重新建立示範資料，內容涵蓋：

- 3 筆 Hotfix、3 筆 Incident、2 筆 RCA、2 筆 Risk Exception、
  2 筆 QA Verification、2 筆 Change / Release、3 筆 Monitoring Inventory、
  2 筆 Backup / Recovery Test（共 19 筆工單），以及 7 個預設使用者（涵蓋 PM/RD/QA/OP/
  資安推動小組/DMS 主管/Admin 各角色）。
- 涵蓋 Red／Yellow／Blue／Green／Gray 五種狀態燈號。
- 涵蓋以下治理情境：
  - QA 驗證不通過的 Hotfix
  - Critical 告警長時間未回應的 Monitoring Inventory
  - 高等級 Incident 尚未建立 RCA
  - Risk Exception 等待 DMS 主管核准
  - Monitoring Inventory 日誌留存天數不足
  - Backup Result 失敗
  - 已結案且佐證資料齊備的工單

若想重新初始化整個資料庫（清空所有資料表結構並重建），可執行：

```bash
npm run db:reset
```

此指令會重新套用 migration 並自動執行 Seed Data。

---

## 四、系統功能說明

### 4.1 使用者與登入

MVP 版本未串接企業 SSO，改以「選擇帳號登入」模擬使用者驗證：首次造訪會導向 `/login`，
選擇一個已啟用的帳號即可登入。登入後 Session 僅保存 `userId`，姓名、角色、啟用狀態一律
即時查詢資料庫，前台無法自行切換或修改角色；只有 Admin 角色可於 `/admin/users` 調整他人角色與帳號狀態。

### 4.2 主要頁面

| 路徑 | 說明 |
| --- | --- |
| `/login` | 登入頁：選擇使用者帳號登入 |
| `/dashboard` | 治理儀表板：KPI 卡片、狀態燈號統計、智慧篩選器、重要工單清單、紅燈項目區、等待確認區、Mock AI 今日摘要 |
| `/issues` | 工單清單，支援篩選 |
| `/issues/new` | 建立工單，依所選工單類型顯示對應動態欄位；負責人 / 建立人僅能從已啟用使用者中選擇 |
| `/issues/[id]` | 工單詳細頁：基本欄位、流程進度條、動態欄位、關卡卡控檢查、佐證資料、留言、異動紀錄、AI 輔助 |
| `/issues/[id]/edit` | 編輯工單 |
| `/admin` | 管理中心（僅 Admin 可存取） |
| `/admin/users` | 使用者與角色（僅 Admin 可存取）：指派角色、啟用 / 停用帳號，異動皆寫入 Audit Log |
| `/admin/workflows` | 流程設定（靜態展示各工單類型的流程關卡，僅 Admin 可存取） |
| `/admin/form-templates` | 表單範本（靜態展示各工單類型的動態欄位定義，僅 Admin 可存取） |

### 4.3 工單類型與流程關卡

系統內建 8 種工單類型，各自有專屬的流程關卡與動態欄位，詳見 `/admin/workflows` 與
`/admin/form-templates`，或參考原始碼 `src/lib/workflow.ts`。

### 4.4 狀態燈號

| 燈號 | 狀態 | 說明 |
| --- | --- | --- |
| 🔴 Red | 異常 / 逾期 | 已逾期、關卡卡控未通過、Critical 告警未回應、QA 不通過或高風險未核准 |
| 🟡 Yellow | 待處理 | 有待辦事項、必要欄位尚未完成但未逾期 |
| 🔵 Blue | 等待確認 | 等待 QA、OP、資安推動小組、系統負責人或 DMS 主管確認 |
| 🟢 Green | 正常 | 流程正常，無逾期、無重大缺漏 |
| ⚪ Gray | 已結案 | 已結案或不適用 |

狀態燈號計算邏輯實作於 `src/lib/statusLight.ts` 的 `calculateStatusLight()`。
只有「Red 且 Critical 告警未回應」的項目，狀態 Badge 會有輕微 pulse 效果，其餘燈號不會閃爍整列。

### 4.5 關卡卡控

關卡卡控邏輯實作於 `src/lib/gateRules.ts` 的 `evaluateGateRules()`，為簡化版規則引擎，
非完整的低代碼規則引擎。工作單詳細頁的「推進至下一關卡」按鈕，只有在關卡卡控通過時才可點擊；
若未通過，畫面會顯示缺少的欄位、缺少的佐證資料，或無法推進的具體原因。

### 4.6 Mock AI 輔助

工作單詳細頁提供 7 種 Mock AI 輔助建議按鈕（問題描述整理、影響範圍建議、RCA 草稿、矯正措施建議、
預防措施建議、下一步建議、缺漏佐證檢查）。目前為規則式產生的模擬內容，尚未串接真正的 AI API，
所有 AI 產出畫面上皆會顯示「AI 建議僅供參考，需由權責人員確認後採用」提示。

Mock AI 的實作獨立於 `src/lib/mockAi.ts`，未來若要串接真正的 AI（例如 Anthropic API），
只需替換 `generateAiSuggestion()` 的實作內容，呼叫端（Server Actions、UI 元件）不需變動。

---

## 五、技術架構

- **Frontend / Backend**：Next.js 14（App Router）＋ TypeScript
- **UI**：Tailwind CSS（自製簡潔元件，未使用完整元件庫；主色為台達電藍 #005BAC，語意色參考 Bootstrap）
- **Database**：SQLite ＋ Prisma ORM（`User`、`AuditLog` 等資料表）
- **Auth**：未串接企業 SSO，以「選擇帳號登入」＋ Session Cookie（僅存 userId）模擬使用者驗證，
  角色與權限一律由伺服器端查詢資料庫決定
- **AI**：Mock AI Service Layer，預留未來串接真實 AI API 的擴充點

### 5.1 未來若要切換至 PostgreSQL

修改 `prisma/schema.prisma` 中的 `datasource db`：

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

並將 `.env` 的 `DATABASE_URL` 改為 PostgreSQL 連線字串，其餘資料模型欄位設計不需大幅更動。

### 5.2 專案結構

```
prisma/
  schema.prisma       # 資料模型定義
  seed.ts              # Seed Data 腳本
src/
  app/                 # Next.js App Router 頁面與 Server Actions 呼叫端
  components/          # UI 元件（狀態 Badge、流程進度條、關卡卡控面板等）
  lib/
    constants.ts       # 角色、工作單類型、狀態燈號等常數（繁體中文顯示文字）
    workflow.ts         # 各工作單類型的流程關卡與動態欄位模板
    statusLight.ts       # calculateStatusLight()：狀態燈號計算邏輯
    gateRules.ts         # evaluateGateRules()：關卡卡控規則引擎
    mockAi.ts            # Mock AI Service Layer
    actions.ts            # Server Actions（建立/編輯工單、流程流轉、留言、佐證、AI 輔助、使用者角色管理）
    prisma.ts              # Prisma Client 單例
    auth.ts                 # 目前登入使用者查詢（Session Cookie 僅存 userId）
    authActions.ts          # 登入 / 登出 Server Actions
    audit.ts                 # 異動紀錄寫入工具（Issue／User 通用）
```

---

## 六、MVP 限制

本系統為刻意精簡的 MVP 版本，以下項目**尚未實作**，適合作為後續擴充方向：

1. **未串接企業 SSO**：以「選擇帳號登入」模擬使用者驗證，角色由 Admin 於 `/admin/users` 指派；
   目前僅 `/admin/*` 頁面依角色限制存取，工單操作尚未逐欄位限制可執行角色
   （例如非 DMS 主管也能核准高風險例外）。
2. **無完整流程編輯器**：`/admin/workflows`、`/admin/form-templates` 僅為靜態展示頁面，
   無法於介面上調整流程關卡或欄位定義，需修改原始碼 `src/lib/workflow.ts`。
3. **關卡卡控為簡化版規則**：`evaluateGateRules()` 以程式碼硬編碼規則，非低代碼規則引擎，
   規則數量與複雜度皆有限，僅涵蓋 PRD 所列之基本卡控情境。
4. **AI 輔助為 Mock 內容**：目前僅為規則式產生的模擬文字，非真正呼叫 LLM API 產生的內容。
5. **流程僅支援單線性推進 / 退回**：不支援平行關卡、條件分支或會簽（多人同時審核）。
6. **無通知機制**：狀態變更、逾期、等待確認等情境目前僅顯示於畫面，未串接 Email、
   MS Teams 等外部通知管道。
7. **無檔案上傳**：佐證資料僅支援「連結」形式（URL），不支援直接上傳檔案。
8. **搜尋 / 篩選為記憶體運算**：目前資料量小，篩選邏輯於伺服器端以 JavaScript 直接運算，
   資料量放大後建議改為資料庫查詢層級的篩選與分頁。

---

## 七、後續擴充建議

1. 導入正式帳號系統（例如 NextAuth.js）並依角色設定可執行動作的權限矩陣。
2. 將 `evaluateGateRules()` 抽換為可視覺化設定的規則引擎，並讓 `/admin/workflows`、
   `/admin/form-templates` 支援線上編輯與版本控管。
3. 串接真正的 AI API（例如 Anthropic Claude API），僅需替換 `src/lib/mockAi.ts` 的實作。
4. 導入通知模組（Email／MS Teams Webhook），於狀態燈號轉為 Red、逾期、等待確認超過一定時間時主動通知。
5. 佐證資料改為支援檔案上傳（例如整合物件儲存服務）。
6. 導入分頁與資料庫層級篩選，因應工作單數量成長。
7. 切換至 PostgreSQL 並部署至正式環境，搭配 CI/CD 自動化部署流程。

---

## 八、常見問題

**Q: 執行 `npm run db:migrate` 或 `npm run db:generate` 時出現下載引擎失敗？**

A: Prisma 需要於首次執行時下載對應作業系統的查詢引擎執行檔，請確認本機網路可正常連上網際網路
（無需任何特殊白名單設定，一般家用或公司網路皆可）。若在企業防火牆環境下遇到問題，
可參考 Prisma 官方文件設定 `PRISMA_ENGINES_MIRROR` 或改用內部套件鏡像。

**Q: 如何清空並重新產生示範資料？**

A: 執行 `npm run db:seed` 即可（會先清空所有資料表再重新建立）。若需要重建資料庫結構，
請改用 `npm run db:reset`。
