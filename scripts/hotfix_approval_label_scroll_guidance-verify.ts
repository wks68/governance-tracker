// Hotfix 詳情頁最後一輪 UI 修正 targeted verify：
//   1. 送簽摘要右側改為對應申請事由／問題摘要的影響摘要，移除無關風險分析框。
//   2. 「應核准人」統一改名為「核准人」。
//   3. 簽核紀錄文字統一「待主管核准」，不再顯示「待審核核准／待審核批准／業務核准」
//      （含 transitionService.ts 對每次關卡轉換寫入、內嵌原始 Stage/Transition.label 的
//      技術 AuditLog 副本——這是「業務核准」實際外洩的根因，本輪在顯示層抑制其重複顯示）。
//   4. 恢復動態雙箭頭 ScrollDownChevron 浮動捲動引導。
// 涵蓋原始碼靜態檢查與真正透過既有服務層／DB 推進 Issue 的整合測試，不假造資料、
// 不繞過既有 actionability。
//   npx tsx scripts/hotfix_approval_label_scroll_guidance-verify.ts

import "./lib/assertSafeTestDatabase";

import * as fs from "node:fs";
import * as path from "node:path";
import * as React from "react";
// CumulativeWorkflowContext.tsx 是 .tsx 檔案，tsconfig 的 jsx:"preserve" 交由 Next 的
// SWC 編譯器處理 automatic runtime；直接以 tsx／esbuild 執行腳本呼叫該元件時，esbuild
// 會退回 classic transform（產生 React.createElement 呼叫），需要全域 React 供其參照。
(globalThis as unknown as { React: typeof React }).React = React;

import { prisma } from "../src/lib/prisma";
import { buildHotfixWorkflowV1 } from "./lib/buildHotfixWorkflowV1";
import { seedFormalOrganization } from "./fixtures/formalOrganizationFixture";
import { createIssueForActor } from "../src/lib/issueCreation";
import { loadHotfixPageContext, buildApprovalReviewViewData } from "../src/lib/hotfix-ui/pageContext";
import { decideApprovalRecord } from "../src/lib/approvalService";
import { executeIssueTransition, returnIssueToStage } from "../src/lib/workflowExecutionService";
import CumulativeWorkflowContext from "../src/components/hotfix-nine-stage/CumulativeWorkflowContext";
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

async function findTransition(versionId: string, fromStageId: string, actionKey: string) {
  return prisma.workflowTransition.findFirstOrThrow({ where: { workflowVersionId: versionId, fromStageId, actionKey } });
}

function hotfixForm(teamId: string, applicantId: string, title: string): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    issueType: "Hotfix",
    title,
    description: "approval label / scroll guidance targeted verify",
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

const BANNED_PHRASES = ["待審核核准", "待審核批准", "業務核准"];

async function main() {
  console.log("\n=== A. 送簽摘要版面（原始碼靜態檢查） ===");

  const requesterPage = source("src/app/issues/[id]/hotfix/approval/requester/page.tsx");
  check(
    "[1] 送簽摘要右側不再顯示無關的風險摘要框（風險等級／緊急程度）",
    !requesterPage.includes("風險與緊急性") && !requesterPage.includes("hotfixPriorityDefOf"),
  );
  check(
    "[2] 送簽摘要右側改為與左側申請內容相對應的「影響摘要」，左右皆有一致的空狀態文字「尚未填寫」",
    requesterPage.includes("申請事由／問題摘要") && requesterPage.includes("影響摘要") &&
      requesterPage.includes('"尚未填寫"') && !requesterPage.includes('"尚未提供"') && !requesterPage.includes('"未提供"') && !requesterPage.includes('"未設定"'),
  );

  console.log("\n=== B. 核准人欄位改名（原始碼靜態檢查） ===");
  const approvalPanel = source("src/components/hotfix-nine-stage/ApprovalReviewPanel.tsx");
  check("[3] ApprovalReviewPanel 欄位標籤已改為「核准人」，不再顯示「應核准人」", approvalPanel.includes(">核准人<") && !approvalPanel.includes("應核准人"));
  check(
    "[4] 核准人姓名沿用既有 buildApprovalReviewViewData／ApprovalRecord 解析結果，未硬編姓名",
    approvalPanel.includes("{expectedApproverLabel ?? roleLabel}") && !/["'`](Wallace|Min)["'`]/.test(approvalPanel),
  );

  console.log("\n=== C. 簽核紀錄文字正規化（原始碼靜態檢查） ===");
  const cumulative = source("src/components/hotfix-nine-stage/CumulativeWorkflowContext.tsx");
  check(
    "[5] 抑制 transitionService 技術 AuditLog 副本（IssueWorkflowAdvanced／Returned／Cancelled／StageCompleted）重複顯示為第二筆歷程",
    cumulative.includes("TRANSITION_MIRROR_ACTION_TYPES") &&
      cumulative.includes('if (TRANSITION_MIRROR_ACTION_TYPES.has(event.actionType)) continue;'),
  );
  check(
    "[6] CumulativeWorkflowContext／ApprovalReviewPanel 原始碼（不含說明性註解外的實際顯示字串）不含任何禁用字樣",
    BANNED_PHRASES.every((phrase) => {
      const codeOnly = cumulative
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");
      return !codeOnly.includes(phrase) && !approvalPanel.includes(phrase);
    }),
  );

  console.log("\n=== D. Scroll Down Icon（原始碼靜態檢查） ===");
  const shell = source("src/components/hotfix-nine-stage/HotfixStageShell.tsx");
  const chevron = source("src/components/ui/ScrollDownChevron.tsx");
  check("[7] HotfixStageShell 掛載 ScrollDownChevron", shell.includes('import ScrollDownChevron from "@/components/ui/ScrollDownChevron"') && shell.includes("<ScrollDownChevron />"));
  check("[8] aria-label 為「向下捲動查看更多內容」，可鍵盤聚焦操作", chevron.includes('aria-label="向下捲動查看更多內容"') && chevron.includes("tabIndex={visible ? 0 : -1}"));
  check("[9] 依內容是否溢出視窗、是否接近底部（120px）決定顯示／隱藏", chevron.includes("NEAR_BOTTOM_THRESHOLD_PX") && chevron.includes("hasOverflow") && chevron.includes("distanceFromBottom"));
  check("[10] 依 #main-content 實際版位置中，避開左側 Sidebar；不隨 fixed 佔用版面高度", chevron.includes('getElementById("main-content")') && chevron.includes("fixed bottom-0"));
  check("[11] z-index（z-30）低於既有 Modal／Dialog（z-50）", chevron.includes("z-30") && !chevron.includes("z-50"));
  check("[12] scroll／resize listener 皆於卸載時清除，scroll 使用 passive，並隨 Route 變化重新計算", /addEventListener\("scroll", updateVisibility, \{ passive: true \}\)/.test(chevron) && chevron.includes('removeEventListener("scroll"') && chevron.includes("usePathname"));
  check("[13] reduced motion 時停止循環動畫但保留靜態雙箭頭（不隱藏 icon 本身）", chevron.includes("motion-reduce:animate-none") && !chevron.includes("motion-reduce:hidden"));
  check("[14] 未引入第三方動畫套件，純 CSS animation＋既有 lucide Icon", !/gsap|framer-motion|react-spring|anime\.js/.test(chevron) && chevron.includes("ChevronDown"));
  check("[15] 點擊時平滑捲動至下一個 data-hotfix-scroll-section，找不到時退回捲動約 70% viewport", chevron.includes("data-hotfix-scroll-section") && chevron.includes("window.innerHeight * 0.7"));

  console.log("\n=== E. 真實 DB 整合：核准人姓名、狀態文字、同意／退回、非核准人邊界 ===");

  const org = await seedFormalOrganization(prisma);
  await prisma.workflowVersion.updateMany({
    where: { status: "PUBLISHED", workflowDefinition: { issueType: "Hotfix" } },
    data: { status: "ARCHIVED" },
  });
  const hotfixWorkflow = await buildHotfixWorkflowV1({
    actorId: org.admin.id,
    reasonCode: "APPROVAL_LABEL_SCROLL_GUIDANCE_VERIFY",
    keySuffix: `approval-label-scroll-${Date.now()}-${process.pid}`,
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

  // ---- 案例 1：同意（Approve）路徑——同時是「業務核准」raw label 實際外洩的關卡轉換 ----
  const approveCase = await createIssueForActor(
    selena,
    hotfixForm(qaTeamId, selena.id, `[verify] 核准人改名與捲動引導：同意路徑 ${Date.now()}`),
    { submitForApproval: true },
  );

  const ctxAaron = await loadHotfixPageContext(approveCase.id, aaron, ["pendingBusinessApproval"]);
  const reviewAaron = await buildApprovalReviewViewData(ctxAaron);
  check("[16] 核准人姓名（Aaron）仍正確來自正式責任資料", reviewAaron?.expectedApproverLabel === "Aaron", reviewAaron?.expectedApproverLabel ?? "");
  check("[17] 應核准人（Aaron）isResponsible 為 true，可執行簽核", reviewAaron?.isResponsible === true);

  const ctxJonus = await loadHotfixPageContext(approveCase.id, jonus, ["pendingBusinessApproval"]);
  const reviewJonus = await buildApprovalReviewViewData(ctxJonus);
  check("[18] 非核准人（Jonus）isResponsible 為 false，無法操作簽核", reviewJonus?.isResponsible === false);

  const pendingApproval = await prisma.approvalRecord.findFirstOrThrow({
    where: { issueId: approveCase.id, relatedStageKey: "pendingBusinessApproval", decision: "PENDING", recordStatus: "ACTIVE" },
  });
  await decideApprovalRecord({ approvalRecordId: pendingApproval.id, actorUserId: aaron.id, decision: "APPROVED" });
  await executeIssueTransition({
    issueId: approveCase.id,
    transitionId: (await findTransition(hotfixWorkflow.version.id, hotfixWorkflow.stageIds.pendingBusinessApproval, "businessApprove")).id,
    actorId: aaron.id,
    reasonCode: "V",
  });
  const issueAfterApprove = await prisma.issue.findUniqueOrThrow({ where: { id: approveCase.id }, include: { currentWorkflowStage: true } });
  check("[19] 主管同意後流程正確推進（離開 pendingBusinessApproval，進入待 RD 團隊接單）", issueAfterApprove.currentWorkflowStage?.stageKey === "pendingRdTriage", issueAfterApprove.currentWorkflowStage?.stageKey);

  const ctxAaronAfter = await loadHotfixPageContext(approveCase.id, aaron, ["pendingBusinessApproval", "pendingRdTriage"]);
  const elementAfter = await CumulativeWorkflowContext({ ctx: ctxAaronAfter });
  const entriesAfter = (elementAfter as unknown as { props: { entries: WorkflowHistoryEntry[] } }).props.entries;
  check(
    "[20] 主管同意後（實際跨越 transitionService 寫入原始「業務核准」raw label 的關卡轉換）歷程中不出現任何禁用字樣",
    entriesAfter.every((entry) => BANNED_PHRASES.every((phrase) => !entry.primary.includes(phrase) && !(entry.detail ?? "").includes(phrase))),
  );
  const draftToApprovalEntry = entriesAfter.find((entry) => entry.id === "creation-summary" || entry.id === "creation-summary-approval");
  check(
    "[21] 正確顯示「草稿 → 待主管核准」與「送出主管簽核」正式語意",
    Boolean(draftToApprovalEntry?.primary.includes("申請人直屬主管簽核")),
  );

  // ---- 案例 2：退回（Reject）路徑 ----
  const rejectCase = await createIssueForActor(
    selena,
    hotfixForm(qaTeamId, selena.id, `[verify] 核准人改名與捲動引導：退回路徑 ${Date.now()}`),
    { submitForApproval: true },
  );
  const rejectRecord = await prisma.approvalRecord.findFirstOrThrow({
    where: { issueId: rejectCase.id, relatedStageKey: "pendingBusinessApproval", decision: "PENDING", recordStatus: "ACTIVE" },
  });
  await decideApprovalRecord({ approvalRecordId: rejectRecord.id, actorUserId: aaron.id, decision: "REJECTED", decisionComment: "verify reject path" });
  await returnIssueToStage({
    issueId: rejectCase.id,
    transitionId: (await findTransition(hotfixWorkflow.version.id, hotfixWorkflow.stageIds.pendingBusinessApproval, "businessReject")).id,
    actorId: aaron.id,
    reasonCode: "verify reject path",
  });
  const issueAfterReject = await prisma.issue.findUniqueOrThrow({ where: { id: rejectCase.id }, include: { currentWorkflowStage: true } });
  check("[22] 主管退回後流程正確退回草稿關卡", issueAfterReject.currentWorkflowStage?.stageKey === "draft", issueAfterReject.currentWorkflowStage?.stageKey);

  const ctxSelenaReject = await loadHotfixPageContext(rejectCase.id, selena, ["draft"]);
  const elementReject = await CumulativeWorkflowContext({ ctx: ctxSelenaReject });
  const entriesReject = (elementReject as unknown as { props: { entries: WorkflowHistoryEntry[] } }).props.entries;
  check(
    "[23] 退回後歷程同樣不出現任何禁用字樣",
    entriesReject.every((entry) => BANNED_PHRASES.every((phrase) => !entry.primary.includes(phrase) && !(entry.detail ?? "").includes(phrase))),
  );

  console.log(`\n結果：PASS ${passed} / FAIL ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
