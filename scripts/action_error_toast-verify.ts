import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  ACTION_ERROR_TOAST_DEDUPE_MS,
  ACTION_ERROR_TOAST_DURATION_MS,
  ACTION_ERROR_TOAST_FADE_MS,
  ACTION_ERROR_TOAST_LIMIT,
  mapActionErrorMessage,
} from "../src/lib/actionErrorToast";

const ROOT = process.cwd();
let passCount = 0;

function source(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function check(name: string, condition: boolean) {
  assert.ok(condition, name);
  passCount += 1;
  console.log(`  PASS  ${name}`);
}

function main() {
  console.log("=== 全站 action error Toast targeted verify ===");
  const provider = source("src/components/toast/AppToastProvider.tsx");
  const adapter = source("src/components/ActionResultBanner.tsx");
  const nav = source("src/components/Nav.tsx");
  const css = source("src/app/globals.css");
  const formPrimitives = source("src/components/ui/FormPrimitives.tsx");
  const loginForm = source("src/app/login/LoginUserForm.tsx");
  const loginPage = source("src/app/login/page.tsx");
  const actionResult = source("src/lib/actionResult.ts");
  const issueCreation = source("src/lib/issueCreation.ts");
  const transitionService = source("src/lib/workflow-execution/transitionService.ts");

  check("[1] 全站只有一種 AppToastProvider 實作且由 Nav 包覆", nav.includes("<AppToastProvider") && fs.readdirSync(path.join(ROOT, "src/components/toast")).filter((name) => name.endsWith("Provider.tsx")).length === 1);
  check("[2] action error 共用 adapter 不再 render 頁內紅框", adapter.includes("notifyActionError") && adapter.includes("return null") && !adapter.includes("bg-danger"));
  check("[3] Server Action 既有相容格式維持 ok/code/message/fieldErrors", actionResult.includes("ok: false") && actionResult.includes("code: string") && actionResult.includes("message: string") && actionResult.includes("fieldErrors?: Record<string, string>"));
  check("[4] 欄位 validation 仍在欄位旁顯示", formPrimitives.includes("{error && <p") && formPrimitives.includes('role="alert"'));
  check("[5] Toast 預設顯示 7 秒、最後 400ms 漸淡", ACTION_ERROR_TOAST_DURATION_MS === 7_000 && ACTION_ERROR_TOAST_FADE_MS === 400 && provider.includes("duration-[400ms]"));
  check("[6] 最多三則且最新通知置頂", ACTION_ERROR_TOAST_LIMIT === 3 && provider.includes("[entry, ...current].slice(0, ACTION_ERROR_TOAST_LIMIT)"));
  check("[7] 同 code 與事項短時間去重", ACTION_ERROR_TOAST_DEDUPE_MS >= 3_000 && provider.includes("`${mapped.code}:${locationKey}`") && provider.includes("recentRef"));
  check("[8] Hover 與 Focus 暫停倒數", provider.includes("onMouseEnter={pause}") && provider.includes("onFocusCapture={pause}") && provider.includes("onMouseLeave={handleMouseLeave}") && provider.includes("onBlurCapture={handleBlur}"));
  check("[9] 可手動關閉且有 aria-label", provider.includes('aria-label="關閉錯誤通知"') && provider.includes("onDismiss(toast.id)"));
  check("[10] Toast 位於 Topbar 下方右上角且 mobile 有安全邊距", provider.includes("top-20") && provider.includes("right-4") && provider.includes("sm:right-5") && provider.includes("27.5rem"));
  check("[11] role alert 與 aria-live 完整", provider.includes('role="alert"') && provider.includes('aria-live="assertive"'));
  check("[12] reduced-motion 取消位移進場動畫", css.includes("prefers-reduced-motion: reduce") && css.includes(".app-toast-enter") && css.includes("animation: none !important"));

  const missingSupervisor = mapActionErrorMessage({
    code: "NoEligibleApproverError",
    message: "所選申請人尚未設定直屬主管或授權代理人，暫時無法建立並送出工單。",
  });
  check("[13] 缺少直屬主管標題與說明符合正式文案", missingSupervisor.title === "無法送出" && missingSupervisor.description === "尚未設定直屬主管，請先完成權責設定後再試一次。");
  check("[14] 權責設定次要操作只依既有權限 prop 顯示", provider.includes("mapped.missingSupervisor && canManageResponsibility") && provider.includes('actionHref: "/settings/approval-governance"'));

  const unknown = mapActionErrorMessage({ code: "UNKNOWN_ERROR", message: "Prisma error at /src/lib/actions.ts:42" });
  check("[15] 未知與技術錯誤不洩漏內部細節", unknown.title === "操作失敗" && unknown.description === "系統暫時無法完成此操作，請稍後再試。" && !unknown.description.includes("Prisma"));
  check("[16] 登入 action 與 redirect error 均改用共用 Toast", loginForm.includes("<ActionErrorText") && loginPage.includes("<ActionErrorText") && !loginForm.includes("bg-danger-bg") && !loginPage.includes("bg-danger-bg"));

  const migratedScopes = [
    "src/components/NewIssueForm.tsx",
    "src/components/hotfix-nine-stage/ClaimTeamPanel.tsx",
    "src/components/hotfix-nine-stage/AssignExecutorPanel.tsx",
    "src/components/hotfix-nine-stage/ApprovalReviewPanel.tsx",
    "src/app/issues/[id]/hotfix/close/ClosureConfirmPanel.tsx",
    "src/components/workflow-execution/TransitionActionForm.tsx",
    "src/components/people/CreatePersonDrawer.tsx",
    "src/components/teams/CreateTeamDrawer.tsx",
    "src/components/SupervisorAssignmentPanel.tsx",
  ];
  check("[17] 指定操作頁均使用同一 ActionErrorText adapter", migratedScopes.every((file) => source(file).includes("ActionErrorText")));
  check("[18] 沒有引入第二套 Toast dependency", !/(?:sonner|react-hot-toast|react-toastify|@radix-ui\/react-toast)/.test(source("package.json")));
  check("[19] 失敗操作與 Audit 保持同一 transaction，不會被記為成功", issueCreation.includes("return prisma.$transaction(async (tx)") && issueCreation.includes("createRequiredApprovalRecordIfNeeded 會拋出 NoEligibleApproverError") && issueCreation.includes("整組回滾") && transitionService.indexOf("createRequiredApprovalRecordIfNeeded") < transitionService.indexOf("await writeAuditLog("));

  console.log(`\n=== 結果：PASS ${passCount} / FAIL 0 ===`);
}

main();
