// 建立工單頁固定系統名稱、team/applicant scope 與 Server 防偽 targeted verify。
// 僅可搭配 scripts/lib/assertSafeTestDatabase 指向的隔離 DB 執行。

import "./lib/assertSafeTestDatabase";

import * as fs from "node:fs";
import { prisma } from "../src/lib/prisma";
import { SYSTEM_NAME_OPTIONS } from "../src/lib/constants";
import {
  resolveIssueCreationScope,
  assertCreationTeamAndApplicant,
  listSelectableApplicants,
} from "../src/lib/team-applicant/issueCreationScope";
import {
  TeamApplicantAccessDeniedError,
  TeamApplicantValidationError,
} from "../src/lib/team-applicant/teamApplicantService";
import {
  createIssueForActor,
  IssueCreationValidationError,
} from "../src/lib/issueCreation";

let passCount = 0;
let failCount = 0;
const tag = `ics-${Date.now().toString(36)}`;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passCount++;
    console.log(`  PASS  ${name}`);
  } else {
    failCount++;
    console.log(`  FAIL  ${name}${detail ? `（${detail}）` : ""}`);
  }
}

async function expectError(name: string, fn: () => Promise<unknown>, matcher: (err: unknown) => boolean) {
  try {
    await fn();
    check(name, false, "預期拒絕但實際成功");
  } catch (err) {
    check(name, matcher(err), err instanceof Error ? `${err.name}: ${err.message}` : String(err));
  }
}

async function createUser(name: string, displayRole: string, activeRole: string) {
  const user = await prisma.user.create({
    data: {
      name: `${tag}-${name}`,
      email: `${tag}-${name}@example.invalid`,
      role: displayRole,
      isActive: true,
    },
  });
  await prisma.userRole.create({ data: { userId: user.id, role: activeRole, isActive: true } });
  return user;
}

async function createTeam(name: string) {
  return prisma.team.create({ data: { name: `${tag}-${name}`, isActive: true } });
}

async function addMember(teamId: string, userId: string, membershipRole: "MEMBER" | "LEAD") {
  await prisma.teamMember.create({ data: { teamId, userId, membershipRole, isActive: true } });
}

function validForm(teamId: string, applicantId: string, overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    issueType: "Hotfix",
    title: "建立工單 scope verify",
    description: "驗證團隊、申請人與固定系統名稱",
    systemName: "MyDMS",
    environment: "Production",
    riskLevel: "中",
    hotfixPriority: "HIGH",
    dueDate: "2026-09-01",
    teamId,
    applicantId,
    ...overrides,
  };
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}

async function main() {
  console.log("=== 建立工單 scope 與固定選項 targeted verify ===");

  const member = await createUser("member", "PM", "PM");
  const otherMember = await createUser("other-member", "RD", "RD");
  const lead = await createUser("lead", "RD", "RD");
  const multiMember = await createUser("multi-member", "PM", "PM");
  const admin = await createUser("admin", "Admin", "Admin");
  // 顯示欄位偽造為 Admin，但 active UserRole 只有 PM：不得取得 Admin 權限。
  const fakeAdmin = await createUser("fake-admin", "Admin", "PM");

  const teamA = await createTeam("A");
  const teamB = await createTeam("B");
  const teamC = await createTeam("C");
  await addMember(teamA.id, member.id, "MEMBER");
  await addMember(teamA.id, otherMember.id, "MEMBER");
  await addMember(teamA.id, lead.id, "LEAD");
  await addMember(teamA.id, fakeAdmin.id, "MEMBER");
  await addMember(teamB.id, multiMember.id, "MEMBER");
  await addMember(teamC.id, multiMember.id, "MEMBER");

  check(
    "[1] SYSTEM_NAME_OPTIONS 恰為四項正式選項",
    JSON.stringify(SYSTEM_NAME_OPTIONS) === JSON.stringify(["MyDMS", "Jarvis AI", "Community", "APP Center"]),
  );

  const memberScope = await resolveIssueCreationScope(member.id);
  check(
    "[2] 一般成員固定自己的唯一 active 團隊與本人",
    memberScope.kind === "MEMBER" &&
      memberScope.fixedTeamId === teamA.id &&
      memberScope.fixedApplicant?.id === member.id &&
      !memberScope.canChooseApplicant,
  );
  await expectError(
    "[3] 一般成員偽造 applicantId 代表同團隊其他成員時被拒絕",
    () => assertCreationTeamAndApplicant(member.id, teamA.id, otherMember.id),
    (err) => err instanceof TeamApplicantAccessDeniedError,
  );
  await expectError(
    "[4] 一般成員偽造其他 teamId 時被拒絕",
    () => assertCreationTeamAndApplicant(member.id, teamB.id, member.id),
    (err) => err instanceof TeamApplicantAccessDeniedError,
  );

  const multiScope = await resolveIssueCreationScope(multiMember.id);
  check(
    "[5] 多個 active 團隊且無正式主要團隊時，以指定友善訊息 fail closed",
    multiScope.blockedReason === "目前帳號同時隸屬多個團隊，尚未設定主要申請團隊，請聯絡系統管理員確認。",
    multiScope.blockedReason ?? undefined,
  );

  const leadScope = await resolveIssueCreationScope(lead.id);
  check(
    "[6] 單一團隊主管固定自己的 LEAD 團隊，但可代表該團隊 active 成員",
    leadScope.kind === "TEAM_LEAD" &&
      leadScope.fixedTeamId === teamA.id &&
      leadScope.fixedApplicant === null &&
      leadScope.canChooseApplicant,
  );
  const leadApplicants = await listSelectableApplicants(lead.id, teamA.id);
  check(
    "[7] 主管申請人清單只含自己主管團隊的 active 成員",
    leadApplicants.some((a) => a.id === member.id) && leadApplicants.some((a) => a.id === lead.id),
  );
  await expectError(
    "[8] 主管不得跨到非 LEAD 團隊",
    () => assertCreationTeamAndApplicant(lead.id, teamB.id, multiMember.id),
    (err) => err instanceof TeamApplicantAccessDeniedError,
  );

  const adminScope = await resolveIssueCreationScope(admin.id);
  check(
    "[9] Admin 可選所有 active 團隊並代表所選團隊 active 成員",
    adminScope.kind === "ADMIN" &&
      [teamA.id, teamB.id, teamC.id].every((id) => adminScope.teams.some((team) => team.id === id)) &&
      adminScope.canChooseApplicant,
  );
  await assertCreationTeamAndApplicant(admin.id, teamA.id, member.id);
  await expectError(
    "[10] Admin 仍不得選擇不屬於所選團隊的 applicantId",
    () => assertCreationTeamAndApplicant(admin.id, teamB.id, member.id),
    (err) => err instanceof TeamApplicantValidationError,
  );

  const fakeAdminScope = await resolveIssueCreationScope(fakeAdmin.id);
  check(
    "[11] User.role=Admin 不授權；active UserRole=PM 的使用者仍是一般成員",
    fakeAdminScope.kind === "MEMBER" && fakeAdminScope.fixedApplicant?.id === fakeAdmin.id,
  );

  const beforeIllegalDrafts = await prisma.issue.count();
  await expectError(
    "[12] 暫存也拒絕偽造 teamId/applicantId，不能先建立非法草稿",
    () => createIssueForActor(member, validForm(teamA.id, otherMember.id), { submitForApproval: false }),
    (err) => err instanceof TeamApplicantAccessDeniedError,
  );
  check("[13] 非法暫存沒有留下 Issue", (await prisma.issue.count()) === beforeIllegalDrafts);

  await expectError(
    "[14] 暫存拒絕固定四項以外的偽造 systemName",
    () =>
      createIssueForActor(member, validForm(teamA.id, member.id, { systemName: "GitLab" }), {
        submitForApproval: false,
      }),
    (err) => err instanceof IssueCreationValidationError,
  );
  await expectError(
    "[15] 正式建立拒絕固定四項以外的偽造 systemName",
    () =>
      createIssueForActor(member, validForm(teamA.id, member.id, { systemName: "其他" }), {
        submitForApproval: true,
      }),
    (err) => err instanceof IssueCreationValidationError,
  );
  await expectError(
    "[16] 正式建立缺少必填問題現象時於寫入前拒絕",
    () =>
      createIssueForActor(member, validForm(teamA.id, member.id, { description: "" }), {
        submitForApproval: true,
      }),
    (err) => err instanceof IssueCreationValidationError,
  );

  const adminDraft = await createIssueForActor(
    admin,
    validForm(teamA.id, member.id, { systemName: "APP Center" }),
    { submitForApproval: false },
  );
  const creationAudit = await prisma.auditLog.findFirst({
    where: { entityType: "Issue", entityId: adminDraft.id, actionType: "IssueCreated" },
  });
  check(
    "[17] Admin 代建時 actor 與 applicant 分開保存",
    adminDraft.reporterUserId === member.id && creationAudit?.actorUserId === admin.id,
  );

  const newForm = fs.readFileSync("src/components/NewIssueForm.tsx", "utf8");
  const editForm = fs.readFileSync("src/app/issues/[id]/hotfix/create/HotfixDraftForm.tsx", "utf8");
  check(
    "[18] 新建與草稿編輯表單都引用共用 SYSTEM_NAME_OPTIONS",
    newForm.includes("SYSTEM_NAME_OPTIONS") && editForm.includes("SYSTEM_NAME_OPTIONS"),
  );
  check(
    "[19] 新建表單只有附件明確標示選填，所有指定必填標籤都有紅星",
    newForm.includes("附件（選填）") &&
      ["工單類型", "標題", "問題現象", "系統名稱", "環境", "風險等級", "Hotfix 工單優先級", "預計完成日"].every(
        (label) => newForm.includes(label),
      ),
  );

  console.log(`=== 結果：PASS ${passCount} / FAIL ${failCount} ===`);
  await prisma.$disconnect();
  if (failCount > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
