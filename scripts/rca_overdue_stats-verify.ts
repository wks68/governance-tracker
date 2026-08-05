// RCA 精確逾期統計 targeted verify：驗證 src/lib/rca-ui/rcaOverdueService.ts 唯一正式判斷
// 來源——以 RcaActionItem.plannedCompletionDate／status／風險例外為準，不得只用
// Issue.dueDate 近似（本輪修正前 /issues?view=rca 的統計卡與清單就是用 Issue.dueDate 近似，
// 這裡直接驗證新服務本身的判斷邏輯，不透過瀏覽器）。
//   npx tsx scripts/rca_overdue_stats-verify.ts

import "./lib/assertSafeTestDatabase";

import { prisma } from "../src/lib/prisma";
import { loadRcaOverdueSummary, loadRcaOverdueSummaries } from "../src/lib/rca-ui/rcaOverdueService";

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

async function createRcaIssueStub(issueKey: string) {
  return prisma.issue.create({
    data: {
      issueKey,
      issueType: "RCA",
      title: `[verify] ${issueKey}`,
      description: "x",
      systemName: "MyDMS",
      environment: "Production",
      reporter: "系統",
      workflowStatus: "rcaAnalysisInProgress",
    },
  });
}

async function main() {
  const now = new Date("2026-08-05T00:00:00.000Z");
  const past = new Date("2026-07-01T00:00:00.000Z");
  const future = new Date("2026-09-01T00:00:00.000Z");
  const pastEarlier = new Date("2026-06-01T00:00:00.000Z");

  console.log("\n=== A. 沒有任何改善措施：不逾期 ===");
  const rcaNoItems = await createRcaIssueStub(`RCA-OVERDUE-A-${Date.now()}`);
  const summaryNoItems = await loadRcaOverdueSummary(rcaNoItems.id, now);
  check("[1] 沒有措施時 isOverdue 為 false", summaryNoItems.isOverdue === false);
  check("[2] 沒有措施時 totalCount 為 0", summaryNoItems.totalCount === 0);

  console.log("\n=== B. 單一逾期未完成措施：逾期 ===");
  const rcaOverdue = await createRcaIssueStub(`RCA-OVERDUE-B-${Date.now()}`);
  await prisma.rcaActionItem.create({ data: { rcaIssueId: rcaOverdue.id, sequence: 1, type: "CORRECTIVE", description: "x", plannedCompletionDate: past, status: "PLANNED" } });
  const summaryOverdue = await loadRcaOverdueSummary(rcaOverdue.id, now);
  check("[3] 單筆逾期未完成措施使 RCA 判定逾期", summaryOverdue.isOverdue === true);
  check("[4] 逾期措施數為 1", summaryOverdue.overdueCount === 1);

  console.log("\n=== C. 逾期但已完成：不算逾期 ===");
  const rcaCompleted = await createRcaIssueStub(`RCA-OVERDUE-C-${Date.now()}`);
  await prisma.rcaActionItem.create({ data: { rcaIssueId: rcaCompleted.id, sequence: 1, type: "CORRECTIVE", description: "x", plannedCompletionDate: past, status: "COMPLETED", actualCompletionDate: past } });
  const summaryCompleted = await loadRcaOverdueSummary(rcaCompleted.id, now);
  check("[5] 已完成措施即使超過預定日期也不算逾期", summaryCompleted.isOverdue === false);
  check("[6] 已完成措施計入 completedCount", summaryCompleted.completedCount === 1);

  console.log("\n=== D. 逾期但已建立風險例外：不算逾期 ===");
  const rcaRiskException = await createRcaIssueStub(`RCA-OVERDUE-D-${Date.now()}`);
  await prisma.rcaActionItem.create({ data: { rcaIssueId: rcaRiskException.id, sequence: 1, type: "PREVENTIVE", description: "x", plannedCompletionDate: past, status: "RISK_EXCEPTION", extensionReason: "已核准風險例外" } });
  const summaryRiskException = await loadRcaOverdueSummary(rcaRiskException.id, now);
  check("[7] 風險例外狀態不算逾期", summaryRiskException.isOverdue === false);

  console.log("\n=== E. 尚未到期：不算逾期 ===");
  const rcaFuture = await createRcaIssueStub(`RCA-OVERDUE-E-${Date.now()}`);
  await prisma.rcaActionItem.create({ data: { rcaIssueId: rcaFuture.id, sequence: 1, type: "CORRECTIVE", description: "x", plannedCompletionDate: future, status: "IN_PROGRESS" } });
  const summaryFuture = await loadRcaOverdueSummary(rcaFuture.id, now);
  check("[8] 預定完成日期尚未到期不算逾期", summaryFuture.isOverdue === false);

  console.log("\n=== F. 多筆混合：正確統計逾期數／最早逾期日／最晚預定日／完成數 ===");
  const rcaMixed = await createRcaIssueStub(`RCA-OVERDUE-F-${Date.now()}`);
  await prisma.rcaActionItem.create({ data: { rcaIssueId: rcaMixed.id, sequence: 1, type: "CORRECTIVE", description: "已完成", plannedCompletionDate: past, status: "COMPLETED", actualCompletionDate: past } });
  await prisma.rcaActionItem.create({ data: { rcaIssueId: rcaMixed.id, sequence: 2, type: "CORRECTIVE", description: "逾期1", plannedCompletionDate: past, status: "PLANNED" } });
  await prisma.rcaActionItem.create({ data: { rcaIssueId: rcaMixed.id, sequence: 3, type: "PREVENTIVE", description: "逾期2更早", plannedCompletionDate: pastEarlier, status: "IN_PROGRESS" } });
  await prisma.rcaActionItem.create({ data: { rcaIssueId: rcaMixed.id, sequence: 4, type: "PREVENTIVE", description: "未到期", plannedCompletionDate: future, status: "PLANNED" } });
  const summaryMixed = await loadRcaOverdueSummary(rcaMixed.id, now);
  check("[9] 混合案例：逾期措施數為 2", summaryMixed.overdueCount === 2);
  check("[10] 混合案例：最早逾期日為最早的一筆", summaryMixed.earliestOverdueDate === pastEarlier.toISOString());
  check("[11] 混合案例：最晚預定完成日期為未到期那筆", summaryMixed.latestPlannedDate === future.toISOString());
  check("[12] 混合案例：完成數為 1", summaryMixed.completedCount === 1);
  check("[13] 混合案例：總數為 4", summaryMixed.totalCount === 4);
  check("[14] 混合案例：isOverdue 為 true", summaryMixed.isOverdue === true);

  console.log("\n=== G. 批次查詢：多筆 RCA 各自獨立，不互相污染（避免 N+1） ===");
  const batch = await loadRcaOverdueSummaries([rcaNoItems.id, rcaOverdue.id, rcaCompleted.id, rcaMixed.id], now);
  check("[15] 批次查詢回傳筆數正確", batch.size === 4);
  check("[16] 批次查詢中 rcaNoItems 仍是不逾期", batch.get(rcaNoItems.id)?.isOverdue === false);
  check("[17] 批次查詢中 rcaOverdue 仍是逾期", batch.get(rcaOverdue.id)?.isOverdue === true);
  check("[18] 批次查詢中 rcaMixed 逾期數與單次查詢一致", batch.get(rcaMixed.id)?.overdueCount === 2);

  console.log(`\n結果：PASS ${passed} / FAIL ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
