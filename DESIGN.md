# DMS WorkHub 設計系統與資訊架構

## 1. 產品定義

- 正式中文名稱：**DMS 工作管理平台**。
- 英文產品識別：**DMS WorkHub**。
- Sidebar 主要功能名稱：**工作管理**；`/work-management` 頁面主標題為 **DMS 工作管理中心**。
- 統一建立入口：**新增事項**；建立頁主標題固定為「你現在要辦理什麼？」。
- 設計目標：以既有 Issue、Workflow、IssueRelation、Audit Log、權限服務與 actionability resolver 為唯一業務來源，提供資訊密度適中、易辨識、可逐步遷移的企業工作台。
- 主要使用者：PM、RD、QA、OP、資安推動小組、DMS 主管、Admin，以及不熟悉內部 enum、資料表或治理術語的一般申請人。
- 理解能力假設：使用者知道要辦理的業務事項，但不應被要求理解 Workflow、Governance、Resolver、IssueType 或內部角色代碼。
- 白話命名原則：導覽與入口使用業務目的；Hotfix 詳情中的「工單編號」「工單基本資訊」等專用名稱保留，不做機械式全域取代。

## 2. 修改前 UI 盤點

### 2.1 Shell、導覽與共用元件

| 範圍 | 現況 | Phase 1／2 決策 |
| --- | --- | --- |
| Root Layout | `src/app/layout.tsx` 直接 render `Nav` 與置中的 `main` | 改由 AppShell 管理 Sidebar、Topbar、Drawer 與主內容 |
| Header／Top Navigation | `src/components/Nav.tsx` 同時放品牌、完整導覽、通知、使用者與登出 | 拆成 server 資料入口＋client AppShell；Topbar 不重複第一層導覽 |
| Sidebar | 不存在 | 建立固定桌面 Sidebar 與窄畫面 Drawer |
| Notification | `ActionableNotificationBell` 使用 `listActionableTasksForActor`，popover 支援 outside click／Esc | 保留 resolver；改善循環動畫、動態稱呼、focus 與空狀態 |
| Data Table | `IssueTable` 與 `GovernanceRecordList` 各自硬編碼 table shell | 建立 DataTable 基礎樣式／容器，Phase 2 先遷移主要清單外框 |
| Filter | `FilterBar` 已以 URL 保存條件，預設收合，支援 outside click／Esc | 保留邏輯，套用 semantic token 與 focus 樣式 |
| Form | `NewIssueForm`、動態欄位與流程表單多處重複 input class | 建立 FormField／FormSection／ReadOnlyField 基礎，先遷移新增事項與 applicant |
| Dialog／Drawer | 已有 `Drawer` 與多個領域專用 drawer/dialog | 不重寫領域行為；新 ResponsiveDrawer 僅服務 AppShell |
| Badge | `StatusBadge` 只顯示色點；另有 `HealthBadge` 與頁面內 badge | StatusBadge 改為文字＋圖示＋顏色；既有 HealthBadge 暫保留 |
| Empty／Loading／Error | 多數頁面各自硬編碼；`ActionResultBanner` 為表單錯誤共用 | 建立基礎 EmptyState、LoadingState、ErrorState，不全面遷移所有流程頁 |
| KPI | `KpiCard` 與 governance-dashboard 元件已存在 | 統一 surface、圓角、陰影與文字 token |
| CSS／Tailwind | `globals.css` 只有背景與動畫；`tailwind.config.ts` 混用品牌、Bootstrap 式與 hex 色 | 加入 CSS variables 與 Tailwind semantic tokens；保留既有 alias 相容性 |
| Icons | 多為內嵌 SVG，沒有 icon library dependency | Phase 1 建立共用線條圖示元件，圖形採 Lucide 的開放圖示語彙，不引入整套非必要元件庫 |

### 2.2 頁面與 route

| 頁面 | 既有 route／資料來源 | 風險與處置 |
| --- | --- | --- |
| 治理儀表板 | `/governance` → `buildGovernanceDashboardViewModel` | 高資料密度；只套 Shell/tokens，不全面重畫圖表 |
| 舊 Dashboard | `/dashboard` redirect `/governance` | 保留相容 redirect |
| Hotfix／季度專案清單 | `/issues?view=hotfix`、`/issues?view=quarterly`；同一 Prisma 查詢、relation summary 與 task resolver | 不建第二套清單；正式導覽直接帶既有 query |
| Hotfix 建立 | `/issues/new` → `resolveIssueCreationScope`、`createIssueAction` | 保留建立核心；加入分類入口、query 預選與唯讀 applicant 呈現 |
| Hotfix 詳情／九階段 | `/issues/[id]` 與 `/issues/[id]/hotfix/**` | 高風險；只確保 Shell 相容，不全面重構 |
| 事件通報 | `/incidents`，資料仍為 `Issue(issueType=Incident)` | 保留 route 與 relation view service；修正建立按鈕文案與 type query |
| RCA | `/rca`，資料仍為 `Issue(issueType=RCA)` | 保留 route 與 relation view service；修正名稱與建立按鈕 |
| 新增事項 | 目前直接使用 `/issues/new` 的通用大表單 | 同 route 加入分類選擇卡，不建立平行建立服務 |
| 人員管理 | `/admin/people` → peopleService row-level scope | 只改入口名稱／Shell，內部表格暫不重構 |
| 團隊管理 | `/admin/teams` → peopleService 與 member scope | 只改 Shell，內部表格暫不重構 |
| 核准治理設定 | `/settings/approval-governance` → `resolveGovernanceAccessContext` | 使用者名稱改為「權責設定」；服務與 route 不更名 |
| 通知鈴鐺 | Top Nav 中的 `ActionableNotificationBell` | 搬到 Topbar，仍用同一 resolver |

### 2.3 重複樣式與可重用範圍

- 重複樣式：`rounded-lg border border-gray-200 bg-white` 卡片、按鈕、input focus、table header、空狀態與 page header 散落於頁面。
- 可重用元件：既有 `Drawer`、`FilterBar`、`IssueTable`、`KpiCard`、`StatusBadge`、`ActionResultBanner`、`ActionableNotificationBell`；新增 AppShell、Sidebar、Topbar、PageHeader、ContentCard、DataTableFrame、FormSection、FormField、ReadOnlyField 與基礎狀態元件。
- 高風險頁面：Hotfix 九階段詳情、approval、claim／assignment、OP deployment、closure、IssueRelation 操作、Audit Log 與管理 CRUD。
- 暫不修改：上述流程頁內部狀態機、完整 dashboard 圖表、人員／團隊／權責設定內部大型表格、八張 OP 申請表。
- Phase 1 安全範圍：tokens、Root Layout、Shell、導覽、共用 presentation primitives、notification presentation。
- Phase 2 安全範圍：工作管理首頁、既有 route 的入口與命名、新增事項分類、Applicant 固定資訊呈現與既有 server guard 測試。

### 2.4 現況根因

- 名稱錯誤入口：Top Nav 使用「工單清單」「建立工單」「核准治理設定」「人員」「團隊」，且沒有正式分群。
- Hotfix 與季度專案：`/issues` 的 `requestedMode` 以 `view=hotfix|quarterly` 區分，底層仍共用查詢與 `IssueTable`。
- 通知 resolver：`src/lib/workflow-execution/actionabilityService.ts` 的 `listActionableTasksForActor`／`resolveIssueTasksForActor`，同時供通知與 `/issues?quick=mine` 使用。
- Applicant 顯示錯誤：`resolveIssueCreationScope` 已正確回傳一般成員 `fixedTeamId`／`fixedApplicant`，server 的 `assertCreationTeamAndApplicant` 也會拒絕偽造；錯誤在 `TeamApplicantSelector` 仍把固定值 render 成 disabled select，空選項文案造成「沒有可選擇的申請人」的錯覺。
- Sidebar／Header 權限來源：登入狀態來自 server session；功能能力必須透過 active `UserRole` 的 `getUserHasCapability` 或既有 row-level service。`User.role` 只能顯示，不參與授權。

## 3. 正式資訊架構與 route 對照

```text
DMS 工作管理平台
├─ 治理儀表板                         /governance
├─ 工作管理                           /work-management
│  ├─ 工作列表
│  │  ├─ Hotfix 清單                  /issues?view=hotfix
│  │  ├─ 季度專案清單                 /issues?view=quarterly
│  │  ├─ 事件通報清單                 /incidents
│  │  └─ RCA 清單                     /rca
│  ├─ 我的待辦                       /issues?view=hotfix&quick=mine
│  └─ 申請與紀錄
│     └─ OP 帳號與權限申請（預留）    不建立 route
├─ 新增事項                           /issues/new
└─ 系統設定
   ├─ 人員管理                        /admin/people
   ├─ 團隊管理                        /admin/teams
   └─ 權責設定                        /settings/approval-governance
```

- 「工作管理」父項目可點擊 `/work-management`，獨立箭頭只控制展開；頁面主標題維持「DMS 工作管理中心」。
- 「我的待辦」沿用 `/issues` 的既有 `quick=mine`、actionability resolver 與通知鈴鐺同一份待辦資料，不另建頁或判斷邏輯。
- 事件通報與 RCA 清單仍使用現有 route、Issue model 與 IssueRelation，Sidebar 不另設重複入口。
- Sidebar 之外，Topbar 提供搜尋入口、通知鈴鐺、使用者資訊與登出。

## 4. 工作管理中心

- 首頁只聚合既有資料：Hotfix、季度專案、事件、RCA 數量；待辦由 actionability resolver 取得；高風險／逾期依既有 Issue 欄位與 workflow helper 顯示。
- 最近更新連回既有詳情；快速入口連回四個既有清單與 `/issues/new`。
- 不複製 `/issues`、`/incidents`、`/rca`，不新增第二套 visibility 或 actionability。
- 「專案流程與緊急修正」說明：季度專案管理本季度開發、改善、測試與上版；Hotfix 處理正式環境急迫修正、驗證與上版。
- 「事件通報與改善」說明：事件通報記錄異常、中斷與資料錯誤；RCA 追查原因與改善措施。

## 5. 新增事項

- `/issues/new` 未選 type 時先呈現三個分類與四個正式可用卡片。
- 季度專案、Hotfix、事件通報、RCA 卡片以 query 預選同一個 `NewIssueForm`，不建立平行 Server Action。
- OP 帳號與權限申請只顯示「即將提供」，沒有按鈕、route、資料表或流程猜測。
- 正式建立表單仍可保留「Hotfix 工單」「工單基本資訊」等流程內專有語句。

## 6. OP 帳號與權限申請預留原則

- 「申請與紀錄」下保留單一分類「OP 帳號與權限申請」。未來預計約八個申請類型，但名稱、欄位、對象、簽核、承辦、核准、結案、權限、附件與稽核要求都尚未確認。
- 本階段不得顯示「申請表 1～8」、不得命名八類、不得建立八個按鈕／route／空資料表、不得修改 Prisma Schema 或執行 migration。
- 未來只能在正式規格確認後，沿用現有 Workflow、Approval、Audit Log 與權限服務漸進加入。

## 7. Design Tokens

### 7.1 色彩

所有值由 `globals.css` CSS variables 定義、由 `tailwind.config.ts` 映射語意名稱：

| Token | 用途 |
| --- | --- |
| `primary`／`primary-hover`／`primary-foreground`／`primary-muted` | 主要動作、active 導覽、focus 與淡色背景；沿用專案既有主藍，僅為暫定產品主色，不宣稱為正式品牌色 |
| `background` | 應用背景 |
| `surface`／`surface-muted` | 卡片、表格、次要區塊 |
| `border`／`input` | 邊界與輸入框 |
| `text-primary`／`text-secondary`／`text-muted` | 三層文字 |
| `success`／`success-muted` | 成功、完成、啟用 |
| `warning`／`warning-muted` | 等待、接近期限 |
| `danger`／`danger-muted` | 高風險、逾期、失敗、危險操作 |
| `info`／`info-muted` | 資訊、等待確認 |
| `disabled` | disabled surface／text |
| `focus-ring` | 鍵盤焦點外框 |

### 7.2 字體、字級、間距、圓角與陰影

- 字體：系統 sans-serif stack；中文優先使用作業系統可讀字型，不額外下載字型。
- 字級：頁面標題 20–24px、區段標題 16–18px、內文 14px、輔助文字 12px；避免巨型標題。
- 間距：4px 基準；常用 8／12／16／24／32px。
- 圓角：控制項 8px、卡片 10–12px、badge 使用 full radius。
- 陰影：卡片使用低對比小陰影；popover／drawer 使用較高層級陰影，不使用霓虹。

## 8. App Shell 規格

### 8.1 Sidebar

- 桌面固定左側，可收成圖示模式；展開狀態不移動 overlay 內元素。
- 顯示 DMS WorkHub 與 DMS 工作管理平台；active 項目用 primary-muted／primary。
- 多層項目有縮排；父連結與展開按鈕分離，使用 `aria-current`、`aria-expanded`。
- 收合模式用 accessible label／title 辨識圖示；不得因收合失去用途資訊。
- 只顯示 actor 有權使用的系統設定子項；三項都不可見時隱藏系統設定。

### 8.2 Topbar

- 包含 Sidebar toggle、breadcrumb／目前位置、搜尋入口、通知、姓名、顯示角色、使用者選單與登出。
- 顯示角色可讀 `User.role`；任何可見性與管理權仍由 active UserRole／row-level scope 決定。

### 8.3 Responsive Drawer

- 窄畫面由 hamburger 開啟；遮罩點擊與 Esc 關閉，開啟時鎖定背景捲動並把焦點移入 Drawer，關閉後回到觸發按鈕。
- 主內容無水平 overflow；資料表放入可控水平捲動容器。

## 9. 共用元件規格

- `PageHeader`：標題、說明、breadcrumb 與主要動作。
- `ContentCard`／`KpiCard`：surface、10–12px radius、柔和 shadow；避免每個欄位各自成巨卡。
- `DataTableFrame`：table caption、overflow、header、row hover／focus 與 empty slot；不同類型不硬塞無意義欄位。
- `FilterPanel`：預設收合、URL 保存、outside click／Esc、清楚套用與清除。
- `FormSection`／`FormField`：一致必填標示、說明、欄位錯誤、focus、disabled 與 loading。
- `ReadOnlyField`：以 definition list 呈現固定團隊／申請人，不用空白 disabled select。
- `StatusBadge`／`PriorityIndicator`：重要狀態一律有文字、圖示與顏色，並提供 `aria-label`。
- `NotificationBell`／`NotificationPopover`：Badge、動作文字、動態稱呼、keyboard、outside click／Esc；查看不改變 resolver 狀態。
- `AppToastProvider`／`ActionErrorText`：全站共用 action error 浮動通知；欄位 validation 仍由 `FormField` 在欄位旁呈現。
- `EmptyState`／`LoadingState`／`ErrorState`：短標題、白話說明與必要下一步，不以顏色作唯一訊號。
- `ConfirmDialog`／`ActionMenu`／`SectionTabs`：沿用現有領域元件；Phase 1 不全面替換。
- `HelpTooltip`／`SearchableSelect`／`MultiSelect`：先列為 Phase 2 後續可重用項，只有實際頁面需要時才引入，避免依賴膨脹。

## 10. 狀態、優先與圖表

- StatusBadge 至少涵蓋草稿、等待處理、處理中、等待核准、已核准、已退回、已完成、已結案、逾期、高風險、失敗、已停用。
- Hotfix 緊急程度固定為最高（紅＋警示圖示＋文字）、高（橘＋圖示＋文字）、低（藍＋圖示＋文字）、最低（灰＋圖示＋文字）。
- 圖表沿用 governance-dashboard view model；色彩取 semantic tokens，必須有標籤／摘要，不以色彩作唯一資訊。

## 11. Notification Bell

- `tasks.length > 0` 時 Badge 顯示，鈴鐺以 transform rotate 晃動約 600ms、停頓約 1.8s，再循環；popover 展開暫停。
- `prefers-reduced-motion: reduce` 停止動畫但保留 Badge。
- 有待辦標題：「{姓名}，輪到你處理了」；副標題：「共 {數量} 件待處理事項」。
- 無待辦：「{姓名}，目前沒有待處理事項」。
- 每筆顯示「{issueKey} 等待你{actionLabel}」；連結只導向既有 `actionHref`，查看不清除待辦。

## 12. Accessibility

- 所有互動元件可用鍵盤；focus 使用 `focus-visible` semantic ring。
- 導覽使用 `aria-current`／`aria-expanded`；icon-only button 有 accessible name。
- Drawer／popover 支援 Esc、outside click 與焦點回復；背景不接收 Drawer focus。
- Status／高風險／逾期／失敗使用圖示＋文字＋顏色；Tooltip 只補充，不是唯一資訊來源。
- 動畫尊重 reduced motion；表格容器可控水平捲動，頁面本身不產生明顯水平 overflow。

### 12.1 Action error Toast

- 固定在 Topbar 下方右上角，桌面寬度上限 440px；手機保留 16px 安全間距，不參與頁面排版。
- 使用 surface、danger-muted、danger、12px 圓角與 overlay shadow；不使用高飽和整塊紅底。
- 預設顯示 7 秒，最後 400ms 漸淡；hover／focus 暫停，最多三則，新通知在最上方，同 code 與事項短時間去重。
- 每則使用 `role="alert"`、可聚焦並提供有 accessible name 的關閉按鈕；reduced motion 取消位移進場動畫。
- 未知或疑似技術錯誤只顯示通用文案，不輸出 stack、SQL、Prisma 或內部路徑。

## 13. 頁面遷移與重構順序

### Phase 1：本輪完成

1. DESIGN.md 與 CSS/Tailwind semantic tokens。
2. AppShell、Sidebar、Topbar、ResponsiveDrawer。
3. PageHeader、ContentCard、DataTableFrame、FormSection／FormField／ReadOnlyField、StatusBadge、Empty／Loading／Error 基礎。
4. NotificationBell presentation 與 accessibility。

### Phase 2：本輪完成

1. `/work-management` 聚合首頁與正式 Sidebar 分群。
2. `/issues/new` 新增事項分類、既有表單 type 預選。
3. `/issues` 四個正式入口中的 Hotfix／季度專案映射；`/incidents`、`/rca` 沿用原 route。
4. 事件通報「建立事件通報」、RCA「建立 RCA」。
5. 系統設定分群與「權責設定」命名。
6. 一般成員唯讀團隊／本人、既有 server 防偽造測試。

### 暫不重構／Phase 2 之後

- Hotfix 所有階段詳情、季度專案完整流程、Incident／RCA 完整建立流程。
- 治理儀表板全部圖表、人員／團隊／權責設定內部完整表格。
- SearchableSelect、MultiSelect、完整 Dialog／ActionMenu 統一，以及尚未定義的 OP 八類申請。
- 不開始 M2-C、C2-B2、C3、C4 或任何 Phase 3／4。

## 14. 不得破壞的功能與資料保護

- 不重寫 Workflow、actionability resolver、IssueRelation、Audit Log、approval、claim、assignment、OP deployment 或 closure。
- Admin CRUD 與 workflow 核准資格分離；Admin 不因角色自動取得簽核、接單、指派、上版或結案權。ApprovalDelegation 只沿用既有核准代理規則，禁止自我核准。
- 授權唯一角色來源為 active UserRole；`User.role` 只顯示／歷史用途。
- 正式 DB `/workspaces/governance-tracker/prisma/dev.db` 與原始 `prisma/hotfix-ui-preview.db` 全程唯讀；測試只用 `/workspaces/dms-governance-relations-ui-preview.db` 或 `/tmp` 隔離副本。
- 不修改 Prisma Schema、不執行正式 migration、不建立 OP 空表、不重建原始 Preview DB。
- Materio 只作淺色 Material 企業後台的視覺參考；不複製其程式碼、CSS、品牌、圖像、內容或資產。
