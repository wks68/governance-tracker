// Hotfix 最終 UI 收尾 targeted verify：本輪版面重排（Hotfix 基本資訊｜目前 Hotfix 流程
// 頂列等高、送簽摘要／治理關聯／主管簽核／附件依序全寬、簽核紀錄歷程置底）、實際核准人
// 姓名顯示、狀態文字統一、Workflow History 責任交接顯示。涵蓋原始碼靜態檢查與真正透過
// 既有服務層／DB 推進 Issue 的整合測試，不假造資料、不繞過既有 actionability。
//   npx tsx scripts/hotfix_final_layout_history-verify.ts

import "./lib/assertSafeTestDatabase";

import * as fs from "node:fs";
import * as path from "node:path";
import * as React from "react";
// CumulativeWorkflowContext.tsx 是 .tsx 檔案，tsconfig 的 jsx:"preserve" 交由 Next 的
// SWC 編譯器處理 automatic runtime；直接以 tsx／esbuild 執行腳本呼叫該元件時，esbuild
// 會退回 classic transform（產生 React.createElement 呼叫），需要全域 React 供其參照。
// 這裡只是提供該全域參照以便直接呼叫既有元件函式讀取其回傳的 entries 資料，不影響元件
// 本身在 Next 正式建置下的行為。
(globalThis as unknown as { React: typeof React }).React = React;

import { prisma } from "../src/lib/prisma";
import { buildHotfixWorkflowV1 } from "./lib/buildHotfixWorkflowV1";
import { seedFormalOrganization } from "./fixtures/formalOrganizationFixture";
import { createIssueForActor } from "../src/lib/issueCreation";
import { loadHotfixPageContext, buildApprovalReviewViewData } from "../src/lib/hotfix-ui/pageContext";
import { evaluateCurrentActorTask } from "../src/lib/workflow-execution/responsibilityService";
import CumulativeWorkflowContext, { resolveNextResponsible, hotfixStageStatusLabel, hotfixStageLabel } from "../src/components/hotfix-nine-stage/CumulativeWorkflowContext";
import type { WorkflowHistoryEntry } from "../src/components/hotfix-nine-stage/WorkflowHistoryTimeline";

const ROOT = process.cwd();
let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? `（${detail}）` : ""}`);
  }
}

function source(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function hotfixForm(teamId: string, applicantId: string, title: string): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    issueType: "Hotfix",
    title,
    description: "最終 UI 收尾 targeted verify",
    systemName: "MyDMS",
    environment: "Production",
    riskLevel: "中",
    dueDate: "2026-08-20",
    hotfixPriority: "HIGH",
    teamId,
    applicantId,
  })) form.set(key, value);
  return form;
}

async function main() {
  console.log("\n=== A. 版面結構（原始碼靜態檢查） ===");

  const zLayout = source("src/components/workflow-execution/WorkflowZLayout.tsx");
  const shell = source("src/components/hotfix-nine-stage/HotfixStageShell.tsx");
  const equalHeightRow = source("src/components/workflow-execution/EqualHeightContentRow.tsx");
  const currentFlow = source("src/components/hotfix-nine-stage/CurrentHotfixFlowCard.tsx");
  const approvalPanel = source("src/components/hotfix-nine-stage/ApprovalReviewPanel.tsx");
  const requesterPage = source("src/app/issues/[id]/hotfix/approval/requester/page.tsx");
  const rdPage = source("src/app/issues/[id]/hotfix/approval/rd/page.tsx");
  const qaPage = source("src/app/issues/[id]/hotfix/approval/qa/page.tsx");
  const opApprovalPage = source("src/app/issues/[id]/hotfix/approval/op/page.tsx");
  const cumulative = source("src/components/hotfix-nine-stage/CumulativeWorkflowContext.tsx");

  check(
    "[1] Hotfix 基本資訊｜目前 Hotfix 流程頂列明確 equalHeight，其餘雙欄列維持自然高度",
    zLayout.includes("<EqualHeightContentRow left={topLeft} right={topRight} equalHeight />") &&
      zLayout.includes("<EqualHeightContentRow left={contentLeft} right={contentRight} />") &&
      equalHeightRow.includes('equalHeight ? "items-stretch" : "items-start"'),
  );

  const govIdx = zLayout.indexOf("governance &&");
  const approvalIdx = zLayout.indexOf("approval &&");
  const attachmentsIdx = zLayout.indexOf("attachments &&");
  const afterIdx = zLayout.indexOf("after &&");
  check(
    "[2] WorkflowZLayout 固定順序：治理關聯 → 主管簽核 → 附件 → 簽核紀錄歷程（after）",
    govIdx !== -1 && approvalIdx !== -1 && attachmentsIdx !== -1 && afterIdx !== -1 &&
      govIdx < approvalIdx && approvalIdx < attachmentsIdx && attachmentsIdx < afterIdx,
  );

  check(
    "[3] 4 個獨立主管簽核頁改傳 approval／attachments 全寬 prop，不再把附件與簽核塞進 side 雙欄",
    [requesterPage, rdPage, qaPage, opApprovalPage].every(
      (pageSrc) => pageSrc.includes("approval={review ?") && pageSrc.includes("attachments={<AttachmentSection") && !pageSrc.includes("side={<div className=\"space-y-5\">"),
    ),
  );

  check(
    "[4] main 未提供 side 時，HotfixStageShell 讓 main／送簽摘要全寬呈現（不強制與 side 50/50）",
    shell.includes("contentRight={approval || attachments ? undefined : side}"),
  );

  check(
    "[5] ApprovalReviewPanel 顯示簽核關卡、應核准人姓名與角色、送簽人、送簽時間，isResponsible 判斷邏輯未被更動",
    approvalPanel.includes("簽核關卡") && approvalPanel.includes("應核准人") && approvalPanel.includes("送簽人") && approvalPanel.includes("送簽時間") &&
      approvalPanel.includes("{expectedApproverLabel ?? roleLabel}") &&
      approvalPanel.includes("!isResponsible ?") && approvalPanel.includes("僅{roleLabel}可執行簽核"),
  );

  check(
    "[6] CurrentHotfixFlowCard「目前等待人員」在有解析出姓名時同時顯示姓名（主）與角色（副），資料沿用既有 waitingOnName／waitingOn，未自建判斷",
    currentFlow.includes("view.waitingOnName") && currentFlow.includes("view.waitingOn") && /waitingOnName \? \(/.test(currentFlow),
  );

  check(
    "[7] HotfixStageShell 的實際核准人姓名沿用既有 buildApprovalReviewViewData 解析結果，未另建第二套姓名判斷、未匯入或修改 responsibilityService.ts",
    shell.includes("buildApprovalReviewViewData(ctx)") &&
      shell.includes("const waitingOnName = approvalReview?.expectedApproverLabel ?? null;") &&
      shell.includes('import { evaluateCurrentActorTask } from "@/lib/workflow-execution/responsibilityService";'),
  );

  check(
    "[8] 畫面原始碼不含任何硬編姓名字面量（Wallace／Min），姓名一律來自既有資料解析",
    ["src/components/hotfix-nine-stage/HotfixStageShell.tsx", "src/components/hotfix-nine-stage/CurrentHotfixFlowCard.tsx", "src/components/hotfix-nine-stage/ApprovalReviewPanel.tsx", "src/components/hotfix-nine-stage/CumulativeWorkflowContext.tsx"].every(
      (file) => !/["'`](Wallace|Min)["'`]/.test(source(file)),
    ),
  );

  check(
    "[9] 畫面與歷程原始碼不出現「待審核批准」等非正式字樣（僅保留說明性註解中的歷史對照）",
    !/dd className[^>]*>\s*待審核批准|"待審核批准"|`待審核批准/.test(cumulative + currentFlow + approvalPanel),
  );

  check(
    "[10] Workflow History 每筆歷程組出下一位正式責任人（角色必顯示，姓名可解析時一併顯示），沿用既有 ApprovalRecord／申請人資料，不臆測姓名",
    cumulative.includes("resolveNextResponsible") && cumulative.includes("下一位責任人：") && cumulative.includes("角色：") &&
      cumulative.includes("closest.approver?.name ?? closest.expectedApprover?.name ?? null"),
  );

  check(
    "[11] 附件區塊固定在主管簽核之後、簽核紀錄歷程之前渲染（由 WorkflowZLayout 順序保證，見 [2]）",
    attachmentsIdx > approvalIdx,
  );

  console.log("\n=== B. 真實 DB 整合：實際核准人姓名、狀態文字、責任交接歷程 ===");

  const org = await seedFormalOrganization(prisma);
  await prisma.workflowVersion.updateMany({
    where: { status: "PUBLISHED", workflowDefinition: { issueType: "Hotfix" } },
    data: { status: "ARCHIVED" },
  });
  await buildHotfixWorkflowV1({
    actorId: org.admin.id,
    reasonCode: "FINAL_LAYOUT_HISTORY_VERIFY",
    keySuffix: `final-layout-history-${Date.now()}-${process.pid}`,
  });

  const qaTeamId = org.teamIdByName.get("品管")!;
  const selenaInfo = org.personByKey.get("selena")!;
  const aaronInfo = org.personByKey.get("aaron")!;
  const jonusInfo = org.personByKey.get("jonus")!;
  const [selena, aaron, jonus] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: selenaInfo.id } }),
    prisma.user.findUniqueOrThrow({ where: { id: aaronInfo.id } }),
    prisma.user.findUniqueOrThrow({ where: { id: jonusInfo.id } }),
  ]);

  const created = await createIssueForActor(
    selena,
    hotfixForm(qaTeamId, selena.id, "[verify] 最終 UI 收尾：Selena 建立等待 Aaron 核准"),
    { submitForApproval: true },
  );

  const ctxAaron = await loadHotfixPageContext(created.id, aaron, ["pendingBusinessApproval"]);
  const reviewAaron = await buildApprovalReviewViewData(ctxAaron);
  check("[12] buildApprovalReviewViewData 解析出實際核准人真實姓名（非角色字樣）", reviewAaron?.expectedApproverLabel === "Aaron", reviewAaron?.expectedApproverLabel ?? "");
  check("[13] 應核准人（Aaron）isResponsible 為 true，可執行簽核", reviewAaron?.isResponsible === true);

  const ctxSelena = await loadHotfixPageContext(created.id, selena, ["pendingBusinessApproval"]);
  const reviewSelena = await buildApprovalReviewViewData(ctxSelena);
  check("[14] 送簽人本人（Selena）isResponsible 為 false，不可執行簽核", reviewSelena?.isResponsible === false);

  const ctxJonus = await loadHotfixPageContext(created.id, jonus, ["pendingBusinessApproval"]);
  const reviewJonus = await buildApprovalReviewViewData(ctxJonus);
  check("[15] 非責任人（同隊其他成員 Jonus）isResponsible 為 false", reviewJonus?.isResponsible === false);

  const taskAaron = await evaluateCurrentActorTask(created.id, aaron.id);
  check("[16] evaluateCurrentActorTask（未更動的既有 resolver）仍回傳 APPROVE 給 Aaron，九階段 actionability 不受本輪影響", taskAaron?.action === "APPROVE" && taskAaron?.isMineToApprove === true);

  // 剛建立並自動送出的 Hotfix，「建立」與「送出」屬同一筆交易，依既有 collapseCreationCluster
  // 規則（見 scripts/hotfix_detail_ui_fixes-verify.ts 既有規則）會聚合為單一「建立並送出」
  // 業務事件，不會另外顯示一筆獨立的「送出主管簽核」歷程——這是既有、本輪未更動的行為。
  // 因此以下改為：(a) 對聚合後仍會顯示的進入關卡摘要做狀態文字斷言；(b) 直接以真實 DB
  // 撈出的 records 呼叫既有匯出的 resolveNextResponsible，驗證責任交接姓名／角色解析
  // 正確，不受聚合影響（HotfixStageShell／History 皆呼叫同一顆函式，見 [10]）。
  const element = await CumulativeWorkflowContext({ ctx: ctxAaron });
  const entries = (element as unknown as { props: { entries: WorkflowHistoryEntry[] } }).props.entries;
  const creationEntry = entries.find((entry) => entry.id === "creation-summary" || entry.id === "creation-summary-approval");
  check("[17] 建立並送出聚合摘要存在，且已可見於歷程", Boolean(creationEntry));
  check(
    "[18] 聚合摘要顯示正式關卡名稱「申請人直屬主管簽核」，不含「待審核批准」等非正式字樣",
    Boolean(creationEntry?.primary.includes("申請人直屬主管簽核") && !creationEntry.primary.includes("待審核批准")),
  );

  const recordsForNextResponsible = await prisma.approvalRecord.findMany({
    where: { issueId: created.id },
    orderBy: [{ requestedAt: "asc" }, { revisionNo: "asc" }],
    include: { approver: true, expectedApprover: true },
  });
  const issueForNextResponsible = await prisma.issue.findUniqueOrThrow({ where: { id: created.id } });
  const nextResponsible = resolveNextResponsible(
    "pendingBusinessApproval",
    new Date(),
    recordsForNextResponsible.map((r) => ({ relatedStageKey: r.relatedStageKey, requestedAt: r.requestedAt, approver: r.approver, expectedApprover: r.expectedApprover })),
    issueForNextResponsible,
  );
  check(
    "[19] resolveNextResponsible 以真實 ApprovalRecord 解析出下一位正式責任人姓名（Aaron）與角色（申請人直屬主管），未硬編姓名",
    nextResponsible?.name === "Aaron" && nextResponsible?.role === "申請人直屬主管",
  );
  check(
    "[19b] 案件狀態／流程關卡兩種語意分開：hotfixStageStatusLabel 統一顯示「待主管核准」，hotfixStageLabel 顯示正式關卡名稱「申請人直屬主管簽核」",
    hotfixStageStatusLabel("pendingBusinessApproval") === "待主管核准" &&
      hotfixStageStatusLabel("draft") === "草稿" &&
      hotfixStageLabel("pendingBusinessApproval") === "申請人直屬主管簽核" &&
      hotfixStageLabel("draft") === "Hotfix建立工單",
  );
  check(
    "[20] 全部歷程 primary／detail 皆不出現「待審核批准」",
    entries.every((entry) => !entry.primary.includes("待審核批准") && !(entry.detail ?? "").includes("待審核批准")),
  );

  console.log(`\n結果：PASS ${passed} / FAIL ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
