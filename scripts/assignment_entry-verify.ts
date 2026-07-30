import "./lib/assertSafeTestDatabase";

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import { prisma } from "../src/lib/prisma";
import {
  assignIssueExecutor,
  listAssignableMembers,
  WorkflowExecutionAccessDeniedError,
} from "../src/lib/workflowExecutionService";

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

async function requireUser(name: string) {
  return prisma.user.findFirstOrThrow({ where: { name, isActive: true } });
}

function names(preview: Awaited<ReturnType<typeof listAssignableMembers>>) {
  return preview.members.map((member) => member.userName).sort((a, b) => a.localeCompare(b, "zh-TW"));
}

async function main() {
  console.log("=== QA／OP 首次指派入口 targeted verify ===");

  const officialDevDb = "/workspaces/governance-tracker/prisma/dev.db";
  const beforeHash = fs.existsSync(officialDevDb) ? crypto.createHash("sha256").update(fs.readFileSync(officialDevDb)).digest("hex") : null;

  const issue = await prisma.issue.findUniqueOrThrow({
    where: { issueKey: "HOTFIX-0012" },
    include: { currentWorkflowStage: true, assignedTeam: true },
  });
  const [nick, aaron, ken, admin, wallace] = await Promise.all([
    requireUser("Nick.Lu"),
    requireUser("Aaron"),
    requireUser("Ken"),
    requireUser("最高權限管理員"),
    requireUser("Wallace"),
  ]);

  check(
    "HOTFIX-0012 位於品管 pendingQaClaim",
    issue.currentWorkflowStage?.stageKey === "pendingQaClaim" && issue.assignedTeam?.name === "品管",
    `${issue.currentWorkflowStage?.stageKey}/${issue.assignedTeam?.name}`,
  );

  const nickPreview = await listAssignableMembers(issue.id, nick.id);
  check("Nick.Lu 為唯讀，不取得指派權或候選清單", !nickPreview.actorIsLead && nickPreview.members.length === 0);

  const kenPreview = await listAssignableMembers(issue.id, ken.id);
  check("品管一般成員 Ken 不取得指派權或候選清單", !kenPreview.actorIsLead && kenPreview.members.length === 0);

  const adminPreview = await listAssignableMembers(issue.id, admin.id);
  check("Admin 不自動取得指派權或候選清單", !adminPreview.actorIsLead && adminPreview.members.length === 0);

  const aaronPreview = await listAssignableMembers(issue.id, aaron.id);
  const qaNames = names(aaronPreview);
  const expectedQaNames = ["Jonus", "Ken", "Selena", "小新"].sort((a, b) => a.localeCompare(b, "zh-TW"));
  check(
    "Aaron 可使用 QA 指派入口",
    aaronPreview.assignable && !aaronPreview.isReassignment && aaronPreview.actorIsLead && aaronPreview.domain === "QA",
  );
  check("Aaron 候選人恰為 Ken／Jonus／小新／Selena", JSON.stringify(qaNames) === JSON.stringify(expectedQaNames), qaNames.join("、"));
  const [historyBeforeLeadAttempt, auditBeforeLeadAttempt] = await Promise.all([
    prisma.issueWorkflowStageHistory.count({ where: { issueId: issue.id } }),
    prisma.auditLog.count({ where: { entityType: "Issue", entityId: issue.id } }),
  ]);
  let leadAssignmentRejected = false;
  try {
    await assignIssueExecutor({
      issueId: issue.id,
      executorUserId: aaron.id,
      actorId: aaron.id,
      reasonCode: "VERIFY_LEAD_NOT_CANDIDATE",
    });
  } catch (err) {
    leadAssignmentRejected = err instanceof WorkflowExecutionAccessDeniedError;
  }
  check(
    "Service 拒絕把 Lead 本人偽造成一般成員候選人，且不寫入 History／AuditLog",
    leadAssignmentRejected &&
      (await prisma.issueWorkflowStageHistory.count({ where: { issueId: issue.id } })) === historyBeforeLeadAttempt &&
      (await prisma.auditLog.count({ where: { entityType: "Issue", entityId: issue.id } })) === auditBeforeLeadAttempt,
  );

  const opTeam = await prisma.team.findFirstOrThrow({ where: { name: "維運", isActive: true } });
  const opStage = await prisma.workflowStage.findFirstOrThrow({
    where: { workflowVersionId: issue.workflowVersionId!, stageKey: "pendingOpClaim" },
  });
  await prisma.issue.update({
    where: { id: issue.id },
    data: {
      assignedTeamId: opTeam.id,
      currentWorkflowStageId: opStage.id,
      workflowStatus: "pendingOpClaim",
    },
  });

  const wallacePreview = await listAssignableMembers(issue.id, wallace.id);
  const opNames = names(wallacePreview);
  const expectedOpNames = ["Howard", "Min"].sort((a, b) => a.localeCompare(b, "zh-TW"));
  check(
    "Wallace 可使用 OP 指派入口",
    wallacePreview.assignable && !wallacePreview.isReassignment && wallacePreview.actorIsLead && wallacePreview.domain === "OP",
  );
  check("Wallace 候選人恰為 Min／Howard", JSON.stringify(opNames) === JSON.stringify(expectedOpNames), opNames.join("、"));

  const dialogSource = fs.readFileSync("src/components/hotfix-nine-stage/AssignExecutorPanel.tsx", "utf8");
  const pageSources = ["rd", "qa", "op"].map((domain) =>
    fs.readFileSync(`src/app/issues/[id]/hotfix/${domain}/page.tsx`, "utf8"),
  );
  check(
    "RD／QA／OP 共用右上角指派 Dialog，正文只保留指派摘要",
    dialogSource.includes('role="dialog"') &&
      dialogSource.includes("`指派 ${preview.domain} 成員`") &&
      pageSources.every(
        (source) =>
          source.includes("headerActions={<AssignExecutorPanel issueId={params.id} preview={preview} />}") &&
          source.includes("<ExecutorAssignmentSummary preview={preview} />"),
      ),
  );

  const afterHash = fs.existsSync(officialDevDb) ? crypto.createHash("sha256").update(fs.readFileSync(officialDevDb)).digest("hex") : null;
  check("正式 dev.db 前後完全不變", beforeHash === afterHash, `before=${beforeHash} after=${afterHash}`);

  console.log(`\n=== 結果：PASS=${passCount} FAIL=${failCount} ===`);
  if (failCount > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("assignment_entry-verify 執行失敗：", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
