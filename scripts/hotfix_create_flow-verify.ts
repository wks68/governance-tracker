// Hotfix 建立工單流程與 UI 缺陷修正 targeted verify。
//
// 對應本輪修正的 6 個人工測試缺陷：
//   [1]-[9]   雙重提交流程：按一次「建立工單」即完成第 1 關並進入第 2 關；
//             「暫存」只留草稿；失敗一律完整 rollback，不留半成品。
//   [10]-[13] 進度條 mapping 依正式 Workflow stage 決定（不依 route）。
//   [14]-[16] 目前節點呼吸動畫：只有目前節點有、不影響 layout、支援 prefers-reduced-motion。
//   [17]-[19] 頁面副標題依目前 Workflow 狀態推導，不由頁面各自寫死。
//   [20]-[21] 申請人下拉選單顯示正式角色名稱（不再出現「Jonus（ ）」）。
//   [22]-[24] Hydration：日期時間格式化在不同時區的行程中輸出完全一致。
//   [25]-[26] 正式 dev.db 未被觸碰、無 journal／wal／shm 殘留。
//
// Fail-closed：第一行 import 為 assertSafeTestDatabase，拒絕連線到本 worktree 的 prisma/dev.db。
//
// 執行方式：
//   touch /path/to/scratch.db && DATABASE_URL="file:/path/to/scratch.db" npx prisma migrate deploy
//   DATABASE_URL="file:/path/to/scratch.db" node_modules/.bin/tsx scripts/hotfix_create_flow-verify.ts

import "./lib/assertSafeTestDatabase";

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { prisma } from "../src/lib/prisma";
import { buildHotfixWorkflowV1 } from "./lib/buildHotfixWorkflowV1";
import { createIssueForActor, IssueCreationValidationError } from "../src/lib/issueCreation";
import { NoEligibleApproverError } from "../src/lib/approvalService";
import { nineStageIndexOfStageKey, hotfixStageSubtitle, routeForStageKey } from "../src/lib/hotfix-ui/nineStage";
import { listActiveApplicantsForTeam } from "../src/lib/team-applicant/teamApplicantService";
import { seedFormalOrganization } from "./fixtures/formalOrganizationFixture";

const OFFICIAL_DEV_DB = "/workspaces/governance-tracker/prisma/dev.db";
const PRISMA_DIR = path.resolve(__dirname, "..", "prisma");

let passCount = 0;
let failCount = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passCount++;
    console.log(`  PASS  ${name}`);
  } else {
    failCount++;
    console.log(`  FAIL  ${name}${detail ? `（${detail}）` : ""}`);
  }
}

async function expectError(name: string, fn: () => Promise<unknown>, ErrCtor: new (...args: any[]) => Error) {
  try {
    await fn();
    failCount++;
    console.log(`  FAIL  ${name}（預期拋出 ${ErrCtor.name}，但實際成功）`);
  } catch (err) {
    if (err instanceof ErrCtor) {
      passCount++;
      console.log(`  PASS  ${name}`);
    } else {
      failCount++;
      console.log(`  FAIL  ${name}（預期 ${ErrCtor.name}，實際 ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}）`);
    }
  }
}

function fd(input: { title: string; teamId: string; applicantId: string; omit?: string }): FormData {
  const f = new FormData();
  const base: Record<string, string> = {
    issueType: "Hotfix",
    title: input.title,
    description: "建立流程 verify",
    systemName: "MyDMS",
    environment: "Production",
    riskLevel: "中",
    dueDate: "2026-08-20",
    hotfixPriority: "HIGH",
    teamId: input.teamId,
    applicantId: input.applicantId,
  };
  for (const [k, v] of Object.entries(base)) {
    if (k === input.omit) continue;
    f.set(k, v);
  }
  return f;
}

async function activeApprovalRecords(issueId: string) {
  return prisma.approvalRecord.findMany({ where: { issueId, recordStatus: "ACTIVE", decision: "PENDING" } });
}

// ---------------------------------------------------------------------------
// A. 雙重提交流程
// ---------------------------------------------------------------------------

async function runCreateFlowChecks() {
  console.log("\n=== A. 雙重提交流程修正 [1]-[9] ===");
  const org = await seedFormalOrganization(prisma);
  // 此 targeted test 會從既有 Preview DB 的隔離副本執行。先在副本內封存既有 Hotfix
  // published versions，確保本測試建立的版本是唯一 auto-start 候選；不依賴空白 DB，
  // 也不會因 Preview fixture 已有正式版本而默默退回 legacy `opened` 流程。
  await prisma.workflowVersion.updateMany({
    where: { status: "PUBLISHED", workflowDefinition: { issueType: "Hotfix" } },
    data: { status: "ARCHIVED" },
  });
  await buildHotfixWorkflowV1({ actorId: org.admin.id, reasonCode: "VERIFY", keySuffix: "create-flow" });

  const qaTeamId = org.teamIdByName.get("品管")!;
  const archTeamId = org.teamIdByName.get("系統架構")!;
  const ken = org.personByKey.get("ken")!;
  const aaron = org.personByKey.get("aaron")!;
  const alex = org.personByKey.get("alex")!;
  const kenUser = await prisma.user.findUniqueOrThrow({ where: { id: ken.id } });
  const alexUser = await prisma.user.findUniqueOrThrow({ where: { id: alex.id } });
  const adminUser = await prisma.user.findUniqueOrThrow({ where: { id: org.admin.id } });

  // [1]-[4] 按一次「建立工單」即進入第 2 關
  const submitted = await createIssueForActor(kenUser, fd({ title: "[verify] 一次送出", teamId: qaTeamId, applicantId: ken.id }), {
    submitForApproval: true,
  });
  check("[1] 按一次「建立工單」後，工單直接進入 pendingBusinessApproval（不停在 draft）", submitted.workflowStatus === "pendingBusinessApproval", `實際 ${submitted.workflowStatus}`);

  const records = await activeApprovalRecords(submitted.id);
  check("[2] 同一次操作已建立恰好一筆 active pending ApprovalRecord", records.length === 1, `實際 ${records.length} 筆`);
  check("[3] expectedApproverUserId 指向申請人的正式直屬主管（Aaron）", records[0]?.expectedApproverUserId === aaron.id);

  const history = await prisma.issueWorkflowStageHistory.findMany({ where: { issueId: submitted.id } });
  check("[4] 已寫入 Workflow History（第 1 關 → 第 2 關）", history.length >= 1, `實際 ${history.length} 筆`);

  const createdAudit = await prisma.auditLog.findFirst({ where: { entityId: submitted.id, actionType: "IssueCreated" } });
  const advancedAudit = await prisma.auditLog.findFirst({ where: { entityId: submitted.id, actionType: "IssueWorkflowAdvanced" } });
  check("[5] 同一次操作同時寫入建立與推進兩筆 AuditLog", !!createdAudit && !!advancedAudit);

  // [6] 暫存：只留草稿
  const draft = await createIssueForActor(kenUser, fd({ title: "[verify] 只暫存", teamId: qaTeamId, applicantId: ken.id }), {
    submitForApproval: false,
  });
  const draftRecords = await activeApprovalRecords(draft.id);
  check("[6] 「暫存」只建立草稿，停在 draft 且不建立任何 ApprovalRecord", draft.workflowStatus === "draft" && draftRecords.length === 0, `${draft.workflowStatus} / ${draftRecords.length} 筆`);

  // [7] 找不到主管 → 完整 rollback，不留半成品
  const beforeCount = await prisma.issue.count();
  const beforeApprovals = await prisma.approvalRecord.count();
  await expectError(
    "[7] 申請人無直屬主管時，建立並送簽整組失敗（NoEligibleApproverError）",
    () => createIssueForActor(alexUser, fd({ title: "[verify] 無主管", teamId: archTeamId, applicantId: alex.id }), { submitForApproval: true }),
    NoEligibleApproverError,
  );
  const afterCount = await prisma.issue.count();
  const afterApprovals = await prisma.approvalRecord.count();
  check(
    "[8] 上述失敗完整 rollback：不留半成品 Issue、不留孤兒 ApprovalRecord",
    afterCount === beforeCount && afterApprovals === beforeApprovals,
    `Issue ${beforeCount}→${afterCount}，Approval ${beforeApprovals}→${afterApprovals}`,
  );

  // [9] 必填欄位不齊時，於任何寫入前就拒絕
  const beforeMissing = await prisma.issue.count();
  await expectError(
    "[9a] 送簽時必填欄位不齊，於寫入前拒絕（IssueCreationValidationError）",
    () =>
      createIssueForActor(kenUser, fd({ title: "[verify] 缺欄位", teamId: qaTeamId, applicantId: ken.id, omit: "hotfixPriority" }), {
        submitForApproval: true,
      }),
    IssueCreationValidationError,
  );
  check("[9b] 必填欄位不齊時完全沒有建立任何 Issue", (await prisma.issue.count()) === beforeMissing);

  // Admin 代建也走同一條路徑，主管仍依申請人解析
  const proxy = await createIssueForActor(adminUser, fd({ title: "[verify] Admin 代建送簽", teamId: qaTeamId, applicantId: ken.id }), {
    submitForApproval: true,
  });
  const proxyRecords = await activeApprovalRecords(proxy.id);
  check(
    "[9c] Admin 代建同樣一次完成送簽，且主管仍解析為申請人的主管（Aaron）",
    proxy.workflowStatus === "pendingBusinessApproval" && proxyRecords[0]?.expectedApproverUserId === aaron.id,
  );

  return { qaTeamId, kenId: ken.id, submittedIssueId: submitted.id };
}

// ---------------------------------------------------------------------------
// B. 進度條 mapping／副標題／路由
// ---------------------------------------------------------------------------

function runProgressBarChecks() {
  console.log("\n=== B. 進度條 mapping 與副標題 [10]-[19] ===");

  const expectedIndex: Record<string, number> = {
    draft: 1,
    pendingBusinessApproval: 2,
    pendingRdTriage: 3,
    pendingRdClaim: 3,
    rdInProgress: 3,
    pendingRdLeadApproval: 4,
    pendingQaTriage: 5,
    pendingQaClaim: 5,
    qaInProgress: 5,
    pendingQaLeadApproval: 6,
    pendingOpTriage: 7,
    pendingOpClaim: 7,
    opPreparing: 7,
    pendingDeploymentApproval: 7,
    opDeploying: 7,
    opCompleted: 8,
    pendingReporterConfirmation: 9,
    reporterConfirming: 9,
    closed: 9,
  };
  const mismatches = Object.entries(expectedIndex).filter(([key, idx]) => nineStageIndexOfStageKey(key) !== idx);
  check("[10] 規格表列出的每個 Workflow 狀態都對應正確的進度條節點", mismatches.length === 0, mismatches.map(([k, v]) => `${k} 應為 ${v} 實際 ${nineStageIndexOfStageKey(k)}`).join("、"));

  check("[11] 送出後 pendingBusinessApproval 對應第 2 關（不是第 1 關）", nineStageIndexOfStageKey("pendingBusinessApproval") === 2);
  check("[12] cancelled 不對應任何九階段節點", nineStageIndexOfStageKey("cancelled") === null);

  // 路由對應：每個 route 應由對應的 stageKey 推導出來
  const routeExpectations: Array<[string, string]> = [
    ["draft", "hotfix/create"],
    ["pendingBusinessApproval", "hotfix/approval/requester"],
    ["rdInProgress", "hotfix/rd"],
    ["pendingRdLeadApproval", "hotfix/approval/rd"],
    ["qaInProgress", "hotfix/qa"],
    ["pendingQaLeadApproval", "hotfix/approval/qa"],
    ["opPreparing", "hotfix/op"],
    ["pendingDeploymentApproval", "hotfix/approval/op"],
    ["reporterConfirming", "hotfix/close"],
    ["cancelled", "hotfix/close"],
  ];
  const routeMismatch = routeExpectations.filter(([key, suffix]) => routeForStageKey("X", key) !== `/issues/X/${suffix}`);
  check("[13] 九個關卡各自導向正確的頁面路由", routeMismatch.length === 0, routeMismatch.map(([k]) => k).join("、"));

  // 呼吸動畫：只加在目前節點，且不改變節點尺寸
  const barSource = fs.readFileSync("src/components/hotfix-nine-stage/NineStageProgressBar.tsx", "utf8");
  check("[14] 只有 isCurrent 節點套用呼吸動畫（已完成／未開始節點不動畫）", /isCurrent && \(\s*<span[\s\S]{0,200}animate-stage-halo/.test(barSource));
  check(
    "[15] 呼吸外圈為絕對定位且 pointer-events-none，不影響 layout、不改變節點寬高",
    /animate-stage-halo[^"]*pointer-events-none[^"]*absolute inset-0/.test(barSource) && /h-7 w-7/.test(barSource),
  );

  const tailwindSource = fs.readFileSync("tailwind.config.ts", "utf8");
  const durationMatch = /"stage-halo (\d+(?:\.\d+)?)s/.exec(tailwindSource);
  const duration = durationMatch ? Number(durationMatch[1]) : 0;
  check("[16a] 呼吸週期落在 1.8～2.5 秒（慢速、非快速閃爍）", duration >= 1.8 && duration <= 2.5, `實際 ${duration}s`);

  const cssSource = fs.readFileSync("src/app/globals.css", "utf8");
  const reducedMotionBlock = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\}\s*\}/.exec(cssSource)?.[0] ?? "";
  check(
    "[16b] 支援 prefers-reduced-motion: reduce（關閉動畫，保留靜態目前節點）",
    reducedMotionBlock.includes("animate-stage-halo") && reducedMotionBlock.includes("animation: none"),
  );

  // 副標題依 Workflow 狀態推導
  check("[17] 第 2 關副標題正確反映「已建立完成，等待主管核准」", hotfixStageSubtitle("pendingBusinessApproval") === "工單已建立完成，等待申請人直屬主管核准中。");
  check("[18] 第 1 關與第 2 關副標題不同（送出後不會再顯示建立說明）", hotfixStageSubtitle("draft") !== hotfixStageSubtitle("pendingBusinessApproval"));
  const missingSubtitle = Object.keys(expectedIndex).filter((k) => !hotfixStageSubtitle(k));
  check("[19a] 每個正式關卡都有對應副標題", missingSubtitle.length === 0, missingSubtitle.join("、"));

  const shellSource = fs.readFileSync("src/components/hotfix-nine-stage/HotfixStageShell.tsx", "utf8");
  check(
    "[19b] 副標題由目前 Workflow 關卡推導（不由頁面各自寫死覆蓋）",
    shellSource.includes("hotfixStageSubtitle(ctx.runtime.currentStage.stageKey)"),
  );
}

// ---------------------------------------------------------------------------
// C. 申請人下拉選單角色名稱
// ---------------------------------------------------------------------------

async function runApplicantOptionChecks(qaTeamId: string, kenId: string) {
  console.log("\n=== C. 申請人下拉選單 [20]-[21] ===");
  const applicants = await listActiveApplicantsForTeam(kenId, qaTeamId);
  const blank = applicants.filter((a) => !a.roleLabel.trim());
  check("[20] 申請人選項的角色名稱都不是空字串（不再顯示「Jonus（ ）」）", blank.length === 0, blank.map((a) => a.name).join("、"));

  const draftFormSource = fs.readFileSync("src/app/issues/[id]/hotfix/create/HotfixDraftForm.tsx", "utf8");
  check("[21] 第 1 關表單不再自行偽造 roleLabel=\"\" 的申請人選項", !/roleLabel:\s*""/.test(draftFormSource));
}

// ---------------------------------------------------------------------------
// D. Hydration：日期時間格式化跨時區一致
// ---------------------------------------------------------------------------

function runHydrationChecks() {
  console.log("\n=== D. Hydration 日期時間 [22]-[24] ===");

  // 真正的重點：同一個時間戳，在不同 TZ 的行程中必須格式化出「完全相同」的字串。
  // 伺服器（容器 UTC）與瀏覽器（Asia/Taipei）算出不同字串，正是 Hydration Error 的根因。
  const snippet = `
    const { formatDateTime, formatDate } = require("./src/lib/datetime.ts");
    console.log(JSON.stringify({
      dt: formatDateTime("2026-07-29T13:38:34.000Z"),
      d: formatDate("2026-07-29T13:38:34.000Z"),
    }));
  `;
  const runUnder = (tz: string) =>
    execFileSync("node_modules/.bin/tsx", ["-e", snippet], {
      env: { ...process.env, TZ: tz },
      encoding: "utf8",
    }).trim().split("\n").pop()!;

  const utc = runUnder("UTC");
  const taipei = runUnder("Asia/Taipei");
  const newYork = runUnder("America/New_York");

  check("[22] 同一時間戳在 UTC 與 Asia/Taipei 行程中格式化結果完全相同", utc === taipei, `UTC=${utc} Taipei=${taipei}`);
  check("[23] 同一時間戳在 America/New_York 行程中格式化結果亦相同", utc === newYork, `UTC=${utc} NY=${newYork}`);

  // 未使用掩蓋手段
  const sourceFiles: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(tsx?|css)$/.test(entry.name)) sourceFiles.push(full);
    }
  };
  walk("src");
  // datetime.ts 只在說明註解中提到這些字樣（明文禁止使用），不算實際使用，故排除。
  const DATETIME_MODULE = path.join("src", "lib", "datetime.ts");
  const suppressUsers = sourceFiles.filter((f) => f !== DATETIME_MODULE && fs.readFileSync(f, "utf8").includes("suppressHydrationWarning"));
  const rawLocaleUsers = sourceFiles.filter(
    (f) => f !== DATETIME_MODULE && /\.toLocale(String|DateString|TimeString)\(/.test(fs.readFileSync(f, "utf8")),
  );
  check("[24a] 未使用 suppressHydrationWarning 掩蓋問題", suppressUsers.length === 0, suppressUsers.join("、"));
  check("[24b] 畫面不再直接呼叫 toLocaleString／toLocaleDateString（一律走固定時區格式化）", rawLocaleUsers.length === 0, rawLocaleUsers.join("、"));
}

// ---------------------------------------------------------------------------

async function main() {
  const beforeHash = fs.existsSync(OFFICIAL_DEV_DB) ? crypto.createHash("sha256").update(fs.readFileSync(OFFICIAL_DEV_DB)).digest("hex") : null;

  const { qaTeamId, kenId } = await runCreateFlowChecks();
  runProgressBarChecks();
  await runApplicantOptionChecks(qaTeamId, kenId);
  runHydrationChecks();

  console.log("\n=== E. 收尾 [25]-[26] ===");
  const afterHash = fs.existsSync(OFFICIAL_DEV_DB) ? crypto.createHash("sha256").update(fs.readFileSync(OFFICIAL_DEV_DB)).digest("hex") : null;
  check("[25] 正式 /workspaces/governance-tracker/prisma/dev.db 全程完全不變", beforeHash === afterHash);

  const residue = fs.readdirSync(PRISMA_DIR).filter((f) => f.endsWith("-journal") || f.endsWith("-wal") || f.endsWith("-shm"));
  check("[26] prisma/ 目錄無 journal／wal／shm 殘留", residue.length === 0, residue.join("、"));

  console.log(`\n=== 結果：PASS=${passCount} FAIL=${failCount} ===`);
  await prisma.$disconnect();
  if (failCount > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error("hotfix_create_flow-verify 執行時發生未預期錯誤：", err);
  await prisma.$disconnect();
  process.exit(1);
});
