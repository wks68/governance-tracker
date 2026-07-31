import "./lib/assertSafeTestDatabase";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/prisma";
import { listAssignableMembers } from "../src/lib/workflowExecutionService";

const ROOT = process.cwd();
let passed = 0;

function source(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function check(name: string, condition: boolean) {
  assert.ok(condition, name);
  passed += 1;
  console.log(`  PASS  ${name}`);
}

async function uniqueActiveUser(name: string) {
  const users = await prisma.user.findMany({ where: { name, isActive: true } });
  assert.equal(users.length, 1, `${name} 必須唯一`);
  return users[0];
}

async function main() {
  console.log("=== 部門呈現與指派入口 targeted verify ===");
  const schema = source("prisma/schema.prisma");
  const peopleTable = source("src/components/people/PeopleTable.tsx");
  const peopleFilters = source("src/components/people/PeopleFilters.tsx");
  const personSummary = source("src/components/people/PersonSummary.tsx");
  const personForm = source("src/components/people/PersonProfileForm.tsx");
  const createPerson = source("src/components/people/CreatePersonDrawer.tsx");
  const peoplePage = source("src/app/admin/people/page.tsx");
  const memberPanel = source("src/components/teams/MemberManagementPanel.tsx");
  const peopleActions = source("src/app/admin/people/actions.ts");
  const teamActions = source("src/app/admin/teams/actions.ts");
  const assignmentSummary = source("src/components/hotfix-nine-stage/ExecutorAssignmentSummary.tsx");
  const assignDialog = source("src/components/hotfix-nine-stage/AssignExecutorPanel.tsx");
  const reassignDialog = source("src/components/hotfix-nine-stage/ReassignExecutorDialog.tsx");
  const assignmentService = source("src/lib/workflow-execution/assignmentService.ts");
  const pageSources = ["rd", "qa", "op"].map((domain) => source(`src/app/issues/[id]/hotfix/${domain}/page.tsx`));

  const peopleUi = [peopleTable, peopleFilters, personSummary, personForm, createPerson, memberPanel].join("\n");
  check("[1] 人員 UI 不再顯示所屬團隊或文字型 department input", !peopleUi.includes("所屬團隊") && !peopleUi.includes('name="department"'));
  check("[2] 清單、建立、編輯、詳情與篩選統一顯示部門", peopleTable.includes(">部門<") && createPerson.includes(">部門<") && personForm.includes(">部門<") && personSummary.includes(">部門<") && peopleFilters.includes("部門：全部"));
  check("[3] 部門值由 Team／TeamMember 與 teamId 提供", peopleTable.includes("p.teamNames") && createPerson.includes('name="teamId"') && peopleActions.includes("createTeamMember({") && peopleActions.includes("teamId,") && memberPanel.includes("value={ctx.teamName}"));
  check("[4] legacy User.department 不再由人員表單 action 寫入", !peopleActions.includes('formData.get("department")') && !teamActions.includes('formData.get("department")'));
  check("[5] Prisma schema 未新增 Department model", !/model\s+Department\b/.test(schema) && schema.includes("model Team") && schema.includes("model TeamMember"));
  check("[5a] 建立與篩選部門選項依既有管理／可見範圍收斂", peoplePage.includes("resolveMemberManagementScope(actor.id)") && peoplePage.includes("managementScope.ledTeamIds.includes(team.id)") && peoplePage.includes("visibleTeamIds.has(team.id)"));

  const accountNames = ["小新", "Aaron", "Yonnve", "Ken", "Wallace", "最高權限管理員"];
  for (const name of accountNames) {
    const user = await uniqueActiveUser(name);
    const memberships = await prisma.teamMember.findMany({
      where: { userId: user.id, isActive: true },
      include: { team: true },
    });
    check(`[部門] ${name} 由 active TeamMember 解析`, memberships.every((membership) => membership.team.name.length > 0));
  }

  check("[6] 指派操作位於目前執行資訊標題同列", assignmentSummary.includes("目前執行資訊") && assignmentSummary.includes("items-start justify-between") && assignmentSummary.includes("<AssignExecutorPanel") && assignmentSummary.includes("<ReassignExecutorDialog"));
  check("[7] 首次與重新指派按鈕使用正式名稱", assignDialog.includes("指派成員") && reassignDialog.includes("重新指派"));
  check("[8] RD／QA／OP 不再把指派入口放在頁首其他位置", pageSources.every((page) => !page.includes("headerActions={<AssignExecutorPanel") && !page.includes("headerActions={<ReassignExecutorDialog") && page.includes("<ExecutorAssignmentSummary issueId={params.id}")));

  const issue = await prisma.issue.findUniqueOrThrow({ where: { issueKey: "HOTFIX-0006" }, include: { currentWorkflowStage: true } });
  const [aaron, ken, admin] = await Promise.all([
    uniqueActiveUser("Aaron"),
    uniqueActiveUser("Ken"),
    uniqueActiveUser("最高權限管理員"),
  ]);
  const [leadPreview, memberPreview, adminPreview] = await Promise.all([
    listAssignableMembers(issue.id, aaron.id),
    listAssignableMembers(issue.id, ken.id),
    listAssignableMembers(issue.id, admin.id),
  ]);
  check("[9] 目前 QA 執行階段的承接團隊主管看得到重新指派能力", issue.currentWorkflowStage?.stageKey === "qaInProgress" && leadPreview.assignable && leadPreview.isReassignment && leadPreview.actorIsLead);
  check("[10] 一般成員與 Admin 都不因身分自動取得指派入口", !memberPreview.actorIsLead && memberPreview.members.length === 0 && !adminPreview.actorIsLead && adminPreview.members.length === 0);
  const eligibleRows = await prisma.teamMember.findMany({
    where: { teamId: leadPreview.teamId!, isActive: true, membershipRole: "MEMBER", user: { isActive: true, userRoles: { some: { role: leadPreview.domain!, isActive: true } } } },
    select: { userId: true },
  });
  check("[11] 指派候選恰為承接團隊 active 合格成員", new Set(leadPreview.members.map((member) => member.userId)).size === eligibleRows.length && eligibleRows.every((row) => leadPreview.members.some((member) => member.userId === row.userId)));
  check("[12] 既有 assignment service 仍負責權限、執行人、時間與 Audit actor", assignmentService.includes("requireLeadOfAssignedTeam") && assignmentService.includes("requireActiveTeamMemberExecutor") && assignmentService.includes("executorAssignedAtFieldKey") && assignmentService.includes("actorUserId: input.actorId"));

  console.log(`\n=== 結果：PASS ${passed} / FAIL 0 ===`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
