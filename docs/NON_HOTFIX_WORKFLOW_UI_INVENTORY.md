# 非 Hotfix Workflow UI 盤點

盤點日期：2026-08-01
限制：此文件只盤點與提出低風險順序，不在本次工作實作非 Hotfix 頁面重構，也不把 Hotfix 九階段 mapping 套用到其他 Issue Type。

## 現況摘要

- 通用詳情 route 是 `/issues/[id]`。除已啟動新版 Workflow 的 Hotfix 會轉址到九階段獨立頁之外，其餘類型都仍在這個 legacy 詳情頁顯示 `WorkflowProgress`、`WorkflowActions`、`GateCheckPanel`、動態欄位、佐證、留言與稽核紀錄。
- legacy Workflow 與欄位模板的主要來源是 `src/lib/workflow.ts` 的 `WORKFLOW_STEPS`、`FORM_TEMPLATES`；gate 與燈號另由 `src/lib/gateRules.ts`、`src/lib/statusLight.ts` 推導。
- 資料模型已支援 `WorkflowDefinition → WorkflowVersion → WorkflowStage/Transition`，但非 Hotfix 詳情頁尚未把 versioned runtime 組成專屬的 stage detail UI。即使偵測到 `currentWorkflowStageId`，仍主要呈現 legacy 詳情結構。
- `WorkflowZLayout` 只是 responsive composition primitive（桌面 7/5 欄與手機閱讀順序），可以共用版面；Hotfix 專屬的九階段名稱、責任卡、引導卡、頁面 context 與 route mapping 不可直接共用。

## Route 與 Workflow 來源

| 類型 | List route | Create route | Detail route | 獨立 stage detail route | 舊式通用詳情頁 | Workflow 定義來源 | 可直接共用 `WorkflowZLayout` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 通用 `/issues/[id]` | 無單一全類型清單；`/issues` 實際只列 Hotfix 與季度專案 | `/issues/new` 先顯示四類 chooser；實際表單仍是共用 `NewIssueForm` | `/issues/[id]` | 否 | 是；這就是 legacy 詳情頁 | `src/lib/workflow.ts`；若 Issue 已綁 version，資料來自 Prisma runtime，但 UI 尚未完整改用 runtime view model | 可以共用純版面，不能直接共用 Hotfix shell 或九階段 progress |
| 季度專案／季度上版 | `/issues?view=quarterly`（亦接受舊 query `issueType=ChangeRelease&changeSubType=QUARTERLY_RELEASE`） | `/issues/new?type=quarterly-project` | `/issues/[id]` | 否 | 是 | `ChangeRelease` 的 legacy `WORKFLOW_STEPS` / `FORM_TEMPLATES`；subtype 為 `QUARTERLY_RELEASE`。目前沒有正式季度上版專屬 versioned Workflow UI | 版面可直接用；stage/progress/action 資料必須依季度流程另建 adapter |
| 事件通報 | `/incidents` | `/issues/new?type=incident` | `/issues/[id]` | 否 | 是 | `Incident` 的 legacy 7 階段與欄位模板；目前沒有已發布的正式 Incident 新版 Workflow | 版面可直接用；事件影響、初步處置、RCA 判定與關聯摘要需自己的 view model |
| RCA | `/rca` | `/issues/new?type=rca` | `/issues/[id]` | 否 | 是 | `RCA` 的 legacy 7 階段與欄位模板；Preview 另有展示用極簡 versioned workflow，不是正式 RCA stage UI | 版面可直接用；根因、矯正／預防措施、改善追蹤與關聯事件需自己的 view model |
| 風險例外 | 無正式專屬 list；現有 dashboard link `/issues?issueType=RiskException` 會被 `/issues` 的 mode resolver 當成 Hotfix view，不能視為有效清單 | 無可達的正式 create route；chooser 與 `NewIssueForm` 都只開放 Hotfix、季度專案、Incident、RCA | 已知 id 時可用 `/issues/[id]` | 否 | 是 | `RiskException` 的 legacy 7 階段與欄位模板；Preview 有展示用極簡 versioned workflow，不是正式 UI | 版面可直接用；先補 route/IA，再抽象風險評估、核准角色、有效期與追蹤資料 |
| 其他 Issue Type | 無正式專屬 list（`QaVerification`、`MonitoringInventory`、`BackupRecoveryTest`；一般 `ChangeRelease` 也沒有獨立入口） | 無目前可達的 create route；雖然 constants/template 有定義，表單 selector 已過濾 | 已知 id 時可用 `/issues/[id]` | 否 | 是 | 各類型的 legacy `WORKFLOW_STEPS` / `FORM_TEMPLATES` | 只可共用版面 primitive；每類 stage、責任角色、終態與條件欄位都要獨立 adapter |

## 可抽象化的資料結構

`WorkflowZLayout` 不應接觸 Hotfix stage key。要安全擴展到非 Hotfix，建議在各類型 adapter 與版面之間建立下列通用 view model：

```ts
interface WorkflowDetailViewModel {
  issue: {
    id: string;
    key: string;
    type: string;
    subtype: string | null;
    title: string;
    description: string;
    metadata: Array<{ key: string; label: string; value: string }>;
  };
  progress: {
    stages: Array<{ key: string; label: string }>;
    currentIndex: number | null;
    terminal: "active" | "completed" | "cancelled";
  };
  responsibility: {
    teamLabel: string | null;
    actorLabel: string | null;
    waitingFor: string | null;
    readOnly: boolean;
  };
  guidance: {
    title: string;
    description: string;
    actions: Array<{ key: string; label: string; kind: "forward" | "return" | "cancel" }>;
  };
  sections: Array<{
    key: string;
    title: string;
    fields: Array<{ key: string; label: string; value: string; editable: boolean }>;
  }>;
  attachments: { canUpload: boolean; items: unknown[] };
  history: unknown[];
}
```

實作時仍需由各 Issue Type adapter 決定：stage 定義、目前階段、完成／取消規則、合法 transition、責任角色、條件欄位、附件權限與 route。不能由 `WorkflowZLayout` 或通用 progress 猜測，也不能引用 `NINE_STAGES`、`nineStageIndexOfStageKey` 或 Hotfix page context。

## 最小風險實作順序

1. 先抽出純展示的 `WorkflowDetailViewModel` 與非 Hotfix progress 元件，建立 adapter contract；保留 `/issues/[id]` 原頁作為 fallback，不改任何 Workflow transition service。
2. 先做季度專案／季度上版：它已有 list/create/detail 的完整可達 route，最適合驗證 layout 與 adapter，不需先改資訊架構。必須先正式確認季度 stages，不能沿用 Hotfix 九階段。
3. 再做 Incident：已有獨立 list/create route，且事件→RCA／Hotfix 關聯資料已存在；先收斂唯讀與 legacy action parity，再決定是否發布 versioned Workflow。
4. 再做 RCA：沿用已存在的 `/rca` 與 create route，但以正式 RCA stages 取代 Preview 的雙關卡示範流程；保留根因／CAPA 欄位與事件關聯。
5. 風險例外先補正 list/create IA 與 route 可達性，再做詳情 adapter；不要在入口不存在時先重寫詳情頁，也不要把 Preview 極簡 workflow 當正式定義。
6. 最後逐一處理 `QaVerification`、`MonitoringInventory`、`BackupRecoveryTest` 與一般 `ChangeRelease`。每一類先確認產品 owner、正式 stages、責任角色與 terminal semantics，再加入入口與 adapter；不得以單一 generic stage 清單覆蓋所有類型。

每一批應先加入 route／view-model parity tests，再切換該類型的詳情 UI；舊通用頁只有在該類型的 list、create、detail、權限、transition、附件、歷程與終態測試全部通過後才可移除對應分支。
