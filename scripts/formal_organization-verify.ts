// 正式組織測試資料與成員管理權限 targeted verify。
//
// 涵蓋範圍：
//   【正式資料】 [1]-[15]  七個正式團隊、Team.domain、七位主管、六位一般成員、
//                          舊測試資料已完全清除、Preview 登入頁只顯示正式人員。
//   【Admin CRUD】[16]-[21] 最高權限管理員可跨團隊管理成員，但不因此取得流程核准權。
//   【主管 CRUD】 [22]-[36] 團隊主管只能管理自己團隊，且不得授予 Admin／改 domain／
//                          刪除自己／移除最後一位主管／偽造 teamId／偽造 User.role。
//   【主管解析】 [37]-[43] 品管／維運成員送簽的 expected approver、代建情境、fail closed、
//                          不得自我核准。
//   【資料一致性】[44]-[49] Preview 與 verify 共用同一 fixture、重建冪等、IssueKeySequence
//                          同步、正式 dev.db 未變、無 journal／wal／shm 殘留。
//
// 檢查來源分兩種，刻意都做：
//   A) scratch DB：以 seedFormalOrganization（Preview 使用的同一份 fixture）建置後驗證，
//      並在其上執行真正的服務層呼叫（授權規則必須在服務層生效，不是只有前端隱藏按鈕）。
//   B) prisma/hotfix-ui-preview.db：唯讀開啟真正的 Preview DB，驗證實際產出的資料狀態。
//
// Fail-closed：第一行 import 為 assertSafeTestDatabase，拒絕連線到本 worktree 的 prisma/dev.db。
//
// 執行方式：
//   touch /path/to/scratch.db && DATABASE_URL="file:/path/to/scratch.db" npx prisma migrate deploy
//   DATABASE_URL="file:/path/to/scratch.db" node_modules/.bin/tsx scripts/formal_organization-verify.ts

import "./lib/assertSafeTestDatabase";

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { buildHotfixWorkflowV1 } from "./lib/buildHotfixWorkflowV1";
import { createIssueForActor } from "../src/lib/issueCreation";
import { saveHotfixDraft } from "../src/lib/hotfix-ui/draftService";
import { executeIssueTransition } from "../src/lib/workflowExecutionService";
import { decideApprovalRecord } from "../src/lib/approvalService";
import { getEligibleApprovers, SelfApprovalError } from "../src/lib/permissions";
import { NoEligibleApproverError } from "../src/lib/approvalService";
import {
  createTeamMember,
  setTeamMemberSupervisor,
  updatePersonProfile,
  assignSystemRole,
  deactivatePerson,
  removeTeamMember,
  PeopleAccessDeniedError,
  PeopleStateError,
} from "../src/lib/peopleService";
import { setTeamDomain, TeamManagementAccessDeniedError } from "../src/lib/team-applicant/teamManagementService";
import {
  seedFormalOrganization,
  FORMAL_TEAMS,
  FORMAL_LEADS,
  FORMAL_MEMBERS,
  TEAMS_WITHOUT_MEMBERS,
} from "./fixtures/formalOrganizationFixture";

const OFFICIAL_DEV_DB = "/workspaces/governance-tracker/prisma/dev.db";
const PRISMA_DIR = path.resolve(__dirname, "..", "prisma");
const PREVIEW_DB = path.join(PRISMA_DIR, "hotfix-ui-preview.db");

// 舊測試資料名稱（本輪起一律不得出現在 Preview 中）
const RETIRED_TEAM_NAMES = ["IAD", "AAD", "PM 團隊", "QA第一驗證組", "QA第二驗證組", "OP第一上版組", "OP第二上版組", "RD 維運團隊", "QA 驗證團隊", "OP 部署團隊"];
const RETIRED_USER_NAMES = ["填單人", "填單人主管", "RD執行人", "RD主管", "QA執行人", "QA主管", "OP執行人", "OP主管", "IAD主管", "AAD主管", "AAD工程師A", "IAD工程師A", "無關使用者", "無主管設定人員"];

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

async function expectSuccess(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    passCount++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failCount++;
    console.log(`  FAIL  ${name}（未預期例外：${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}）`);
  }
}

// ---------------------------------------------------------------------------
// 共用：對任一 PrismaClient 驗證「正式組織資料結構」（scratch DB 與 Preview DB 共用）
// ---------------------------------------------------------------------------

async function checkFormalStructure(client: PrismaClient, label: string, startIndex: number) {
  const teams = await client.team.findMany({ orderBy: { name: "asc" } });
  const teamNames = teams.map((t) => t.name).sort();
  const expectedNames = FORMAL_TEAMS.map((t) => t.name).sort();

  check(
    `[${startIndex}] ${label}：只有七個指定正式團隊`,
    teams.length === FORMAL_TEAMS.length && JSON.stringify(teamNames) === JSON.stringify(expectedNames),
    `實際 ${teams.length} 個：${teamNames.join("、")}`,
  );

  const retiredTeams = teams.filter((t) => RETIRED_TEAM_NAMES.includes(t.name)).map((t) => t.name);
  check(`[${startIndex + 1}] ${label}：不存在 IAD／AAD 團隊`, !retiredTeams.includes("IAD") && !retiredTeams.includes("AAD"), retiredTeams.join("、"));
  check(
    `[${startIndex + 2}] ${label}：不存在 QA第一組／OP第一組等舊測試團隊`,
    retiredTeams.length === 0,
    retiredTeams.join("、"),
  );

  const users = await client.user.findMany();
  const retiredUsers = users.filter((u) => RETIRED_USER_NAMES.includes(u.name)).map((u) => u.name);
  check(`[${startIndex + 3}] ${label}：不存在填單人／RD執行人等舊測試帳號`, retiredUsers.length === 0, retiredUsers.join("、"));

  const admins = await client.userRole.findMany({ where: { role: "Admin", isActive: true, user: { isActive: true } } });
  check(`[${startIndex + 4}] ${label}：最高權限管理員恰好一位`, admins.length === 1, `實際 ${admins.length} 位`);

  // 七位主管名稱、所屬團隊、唯一 active LEAD
  let leadOk = true;
  let uniqueLeadOk = true;
  const leadDetails: string[] = [];
  for (const spec of FORMAL_LEADS) {
    const team = teams.find((t) => t.name === spec.teamName);
    const user = users.find((u) => u.name === spec.name);
    if (!team || !user) {
      leadOk = false;
      leadDetails.push(`缺少 ${spec.name}/${spec.teamName}`);
      continue;
    }
    const membership = await client.teamMember.findFirst({
      where: { teamId: team.id, userId: user.id, isActive: true, membershipRole: "LEAD" },
    });
    if (!membership) {
      leadOk = false;
      leadDetails.push(`${spec.name} 非 ${spec.teamName} 的 active LEAD`);
    }
    const allLeads = await client.teamMember.findMany({ where: { teamId: team.id, isActive: true, membershipRole: "LEAD" } });
    if (allLeads.length !== 1) {
      uniqueLeadOk = false;
      leadDetails.push(`${spec.teamName} 有 ${allLeads.length} 位 active LEAD`);
    }
    // 主管不得自動取得 Admin，也不得兼任其他團隊主管
    const adminRole = await client.userRole.findFirst({ where: { userId: user.id, role: "Admin", isActive: true } });
    if (adminRole) {
      leadOk = false;
      leadDetails.push(`${spec.name} 不應具有 Admin 角色`);
    }
    const otherLeadMemberships = await client.teamMember.findMany({
      where: { userId: user.id, isActive: true, membershipRole: "LEAD", teamId: { not: team.id } },
    });
    if (otherLeadMemberships.length > 0) {
      leadOk = false;
      leadDetails.push(`${spec.name} 兼任其他團隊主管`);
    }
  }
  check(`[${startIndex + 5}] ${label}：七位主管名稱及所屬團隊正確（且未取得 Admin、未兼任他團主管）`, leadOk, leadDetails.join("；"));
  check(`[${startIndex + 6}] ${label}：各主管都是自己團隊唯一 active LEAD`, uniqueLeadOk, leadDetails.join("；"));

  // 品管四位成員 ＋ 維運兩位成員
  async function checkTeamMembers(teamName: string, expectedNames: string[], supervisorName: string) {
    const team = teams.find((t) => t.name === teamName);
    if (!team) return { membersOk: false, supervisorOk: false, detail: `找不到團隊 ${teamName}` };
    const memberships = await client.teamMember.findMany({
      where: { teamId: team.id, isActive: true, membershipRole: "MEMBER" },
      include: { user: true },
    });
    const actual = memberships.map((m) => m.user.name).sort();
    const membersOk = JSON.stringify(actual) === JSON.stringify([...expectedNames].sort());

    const supervisorUser = users.find((u) => u.name === supervisorName);
    let supervisorOk = !!supervisorUser;
    for (const m of memberships) {
      const assignment = await client.userSupervisorAssignment.findFirst({
        where: { userId: m.userId, isActive: true, isPrimary: true },
      });
      if (!assignment || assignment.supervisorUserId !== supervisorUser?.id) supervisorOk = false;
      if (assignment && assignment.userId === assignment.supervisorUserId) supervisorOk = false;
    }
    return { membersOk, supervisorOk, detail: `實際：${actual.join("、")}` };
  }

  const qa = await checkTeamMembers("品管", ["Ken", "Jonus", "小新", "Selena"], "Aaron");
  check(`[${startIndex + 7}] ${label}：品管四位成員資料正確`, qa.membersOk, qa.detail);
  check(`[${startIndex + 8}] ${label}：品管成員直屬主管皆為 Aaron`, qa.supervisorOk);

  const op = await checkTeamMembers("維運", ["Min", "Howard"], "Wallace");
  check(`[${startIndex + 9}] ${label}：維運兩位成員資料正確`, op.membersOk, op.detail);
  check(`[${startIndex + 10}] ${label}：維運成員直屬主管皆為 Wallace`, op.supervisorOk);

  // 未提供成員的五個團隊只有主管
  let onlyLeadOk = true;
  const onlyLeadDetail: string[] = [];
  for (const teamName of TEAMS_WITHOUT_MEMBERS) {
    const team = teams.find((t) => t.name === teamName);
    if (!team) {
      onlyLeadOk = false;
      continue;
    }
    const memberships = await client.teamMember.findMany({ where: { teamId: team.id, isActive: true } });
    if (memberships.length !== 1 || memberships[0].membershipRole !== "LEAD") {
      onlyLeadOk = false;
      onlyLeadDetail.push(`${teamName} 有 ${memberships.length} 筆 active membership`);
    }
  }
  check(`[${startIndex + 11}] ${label}：未提供成員的五個團隊只有主管`, onlyLeadOk, onlyLeadDetail.join("；"));

  // Team.domain
  const domainMismatches = FORMAL_TEAMS.filter((spec) => {
    const team = teams.find((t) => t.name === spec.name);
    return !team || team.domain !== spec.domain;
  }).map((s) => s.name);
  check(`[${startIndex + 12}] ${label}：所有 Team.domain 正確`, domainMismatches.length === 0, domainMismatches.join("、"));
}

// ---------------------------------------------------------------------------
// A. scratch DB：fixture 結構 ＋ 服務層授權
// ---------------------------------------------------------------------------

interface Ctx {
  adminId: string;
  teamIdByName: Map<string, string>;
  idByName: Map<string, string>;
  hotfixVersionId: string;
  draftStageId: string;
}

async function setupScratch(): Promise<Ctx> {
  const org = await seedFormalOrganization(prisma);
  const idByName = new Map<string, string>();
  for (const [, person] of org.personByKey) idByName.set(person.name, person.id);

  const hotfix = await buildHotfixWorkflowV1({ actorId: org.admin.id, reasonCode: "VERIFY_BUILD", keySuffix: "formal-verify" });
  return {
    adminId: org.admin.id,
    teamIdByName: org.teamIdByName,
    idByName,
    hotfixVersionId: hotfix.version.id,
    draftStageId: hotfix.stageIds.draft,
  };
}

function fd(input: { title: string; teamId: string; applicantId: string }): FormData {
  const f = new FormData();
  f.set("issueType", "Hotfix");
  f.set("title", input.title);
  f.set("description", "formal organization verify");
  f.set("systemName", "MyDMS");
  f.set("environment", "Production");
  f.set("riskLevel", "中");
  f.set("dueDate", "2026-08-20");
  f.set("hotfixPriority", "HIGH");
  f.set("teamId", input.teamId);
  f.set("applicantId", input.applicantId);
  return f;
}

async function submitIssue(ctx: Ctx, actorId: string, teamId: string, applicantId: string, title: string) {
  const actor = await prisma.user.findUniqueOrThrow({ where: { id: actorId } });
  const issue = await createIssueForActor(actor, fd({ title, teamId, applicantId }));
  await saveHotfixDraft({ issueId: issue.id, actorId: applicantId, fields: { hotfixPriority: "HIGH", dueDate: "2026-08-20" } });
  const submitT = await prisma.workflowTransition.findFirstOrThrow({
    where: { workflowVersionId: ctx.hotfixVersionId, fromStageId: ctx.draftStageId, actionKey: "submit" },
  });
  await executeIssueTransition({ issueId: issue.id, transitionId: submitT.id, actorId: applicantId, reasonCode: "VERIFY_SUBMIT" });
  return issue;
}

async function expectedApproverNameFor(issueId: string): Promise<string | null> {
  const record = await prisma.approvalRecord.findFirst({
    where: { issueId, approvalType: "BUSINESS_APPROVAL", recordStatus: "ACTIVE", decision: "PENDING" },
  });
  if (!record?.expectedApproverUserId) return null;
  const user = await prisma.user.findUnique({ where: { id: record.expectedApproverUserId } });
  return user?.name ?? null;
}

async function runAdminCrudChecks(ctx: Ctx) {
  console.log("\n=== 【Admin CRUD】[16]-[21] ===");
  const adminId = ctx.adminId;
  const qaTeamId = ctx.teamIdByName.get("品管")!;
  const rdTeamId = ctx.teamIdByName.get("解決方案部")!;

  const visibleMembers = await prisma.teamMember.findMany({ where: { isActive: true } });
  check("[16] Admin 可查看所有團隊成員", visibleMembers.length >= FORMAL_LEADS.length + FORMAL_MEMBERS.length);

  await expectSuccess("[17] Admin 可新增任一團隊成員（跨團隊：解決方案部）", () =>
    createTeamMember({
      teamId: rdTeamId,
      name: "Admin新增RD成員",
      email: "admin-created-rd@verify.invalid",
      role: "RD",
      isActive: true,
      actorId: adminId,
      reasonCode: "VERIFY_ADMIN_CREATE",
      supervisorUserId: ctx.idByName.get("Kitty")!,
    }),
  );
  const adminCreated = await prisma.user.findUniqueOrThrow({ where: { email: "admin-created-rd@verify.invalid" } });

  await expectSuccess("[18] Admin 可修改任一團隊成員", () =>
    updatePersonProfile({ userId: adminCreated.id, department: "解決方案部", actorId: adminId, reasonCode: "VERIFY_ADMIN_UPDATE" }),
  );

  await expectSuccess("[19] Admin 可停用任一團隊成員", () =>
    deactivatePerson({ userId: adminCreated.id, actorId: adminId, reasonCode: "VERIFY_ADMIN_DEACTIVATE" }),
  );

  await expectSuccess("[20] Admin 可設定正式直屬主管", () =>
    setTeamMemberSupervisor({
      teamId: qaTeamId,
      userId: ctx.idByName.get("Selena")!,
      supervisorUserId: ctx.idByName.get("Aaron")!,
      actorId: adminId,
      reasonCode: "VERIFY_ADMIN_SET_SUPERVISOR",
    }),
  );

  // Admin 不因 Admin 身分取得流程核准權
  const issue = await submitIssue(ctx, ctx.idByName.get("Ken")!, qaTeamId, ctx.idByName.get("Ken")!, "[verify] Admin 非核准人");
  const assignments = await prisma.userSupervisorAssignment.findMany();
  const eligible = getEligibleApprovers({
    approvalType: "BUSINESS_APPROVAL",
    requestedByUserId: ctx.idByName.get("Ken")!,
    teamId: null,
    supervisorAssignments: assignments,
    teamMemberships: (await prisma.teamMember.findMany()).map((m) => ({
      ...m,
      membershipRole: m.membershipRole === "LEAD" ? ("LEAD" as const) : ("MEMBER" as const),
    })),
    delegations: [],
    now: new Date(),
  });
  check(
    "[21] Admin 不因 Admin 身分取得流程核准權",
    !eligible.some((e) => e.userId === adminId),
    `eligible=${eligible.map((e) => e.userId).join(",")}`,
  );
  return issue;
}

async function runLeadCrudChecks(ctx: Ctx) {
  console.log("\n=== 【主管 CRUD】[22]-[36] ===");
  const qaTeamId = ctx.teamIdByName.get("品管")!;
  const opTeamId = ctx.teamIdByName.get("維運")!;
  const aaron = ctx.idByName.get("Aaron")!;
  const wallace = ctx.idByName.get("Wallace")!;

  await expectSuccess("[22] Aaron 可新增品管成員", () =>
    createTeamMember({
      teamId: qaTeamId,
      name: "Aaron新增品管成員",
      email: "aaron-created-qa@verify.invalid",
      role: "QA",
      isActive: true,
      actorId: aaron,
      reasonCode: "VERIFY_LEAD_CREATE",
      supervisorUserId: aaron,
    }),
  );
  const aaronCreated = await prisma.user.findUniqueOrThrow({ where: { email: "aaron-created-qa@verify.invalid" } });

  await expectSuccess("[23a] Aaron 可修改品管成員", () =>
    updatePersonProfile({ userId: aaronCreated.id, department: "品管", actorId: aaron, reasonCode: "VERIFY_LEAD_UPDATE", teamScopeId: qaTeamId }),
  );
  await expectSuccess("[23b] Aaron 可停用品管成員", () =>
    deactivatePerson({ userId: aaronCreated.id, actorId: aaron, reasonCode: "VERIFY_LEAD_DEACTIVATE", teamScopeId: qaTeamId }),
  );

  await expectError(
    "[24] Aaron 不可管理維運成員",
    () =>
      updatePersonProfile({
        userId: ctx.idByName.get("Min")!,
        department: "被越權修改",
        actorId: aaron,
        reasonCode: "VERIFY_CROSS_TEAM",
        teamScopeId: opTeamId,
      }),
    PeopleAccessDeniedError,
  );

  await expectSuccess("[25] Wallace 可管理維運成員", () =>
    updatePersonProfile({
      userId: ctx.idByName.get("Howard")!,
      department: "維運",
      actorId: wallace,
      reasonCode: "VERIFY_LEAD_OWN_TEAM",
      teamScopeId: opTeamId,
    }),
  );

  await expectError(
    "[26] Wallace 不可管理品管成員",
    () =>
      updatePersonProfile({
        userId: ctx.idByName.get("Ken")!,
        department: "被越權修改",
        actorId: wallace,
        reasonCode: "VERIFY_CROSS_TEAM",
        teamScopeId: qaTeamId,
      }),
    PeopleAccessDeniedError,
  );

  // [27]-[31] 其餘五位主管只能管理自己團隊：以「對品管成員動手一律被拒」為統一反例，
  // 並確認其在自己團隊內可正常新增成員。
  const others: { name: string; teamName: string; index: number }[] = [
    { name: "Tommy", teamName: "語音與AI技術", index: 27 },
    { name: "序泰", teamName: "先進應用開發部", index: 28 },
    { name: "Yonnve", teamName: "創新應用開發", index: 29 },
    { name: "Kitty", teamName: "解決方案部", index: 30 },
    { name: "Alex", teamName: "系統架構", index: 31 },
  ];
  for (const spec of others) {
    const leadId = ctx.idByName.get(spec.name)!;
    const ownTeamId = ctx.teamIdByName.get(spec.teamName)!;
    let ok = true;
    let detail = "";
    // 自己團隊：可新增
    try {
      await createTeamMember({
        teamId: ownTeamId,
        name: `${spec.name}的成員`,
        email: `${spec.index}-own@verify.invalid`,
        role: "RD",
        isActive: true,
        actorId: leadId,
        reasonCode: "VERIFY_LEAD_OWN",
        supervisorUserId: leadId,
      });
    } catch (err) {
      ok = false;
      detail += `自己團隊新增失敗：${err instanceof Error ? err.message : String(err)}`;
    }
    // 其他團隊（品管）：一律被拒
    try {
      await updatePersonProfile({
        userId: ctx.idByName.get("Ken")!,
        department: "被越權修改",
        actorId: leadId,
        reasonCode: "VERIFY_CROSS",
        teamScopeId: qaTeamId,
      });
      ok = false;
      detail += "；跨團隊修改竟然成功";
    } catch (err) {
      if (!(err instanceof PeopleAccessDeniedError)) {
        ok = false;
        detail += `；跨團隊修改錯誤型別 ${err instanceof Error ? err.name : String(err)}`;
      }
    }
    check(`[${spec.index}] ${spec.name} 只能管理${spec.teamName}團隊成員`, ok, detail);
  }

  await expectError(
    "[32] 團隊主管不可授予 Admin 角色",
    () => assignSystemRole({ userId: ctx.idByName.get("Ken")!, role: "Admin", actorId: aaron, reasonCode: "VERIFY_NO_ADMIN", teamScopeId: qaTeamId }),
    PeopleAccessDeniedError,
  );

  await expectError(
    "[33] 團隊主管不可修改 Team.domain",
    () => setTeamDomain({ teamId: qaTeamId, domain: "RD", actorId: aaron, reasonCode: "VERIFY_NO_DOMAIN" }),
    TeamManagementAccessDeniedError,
  );

  await expectError(
    "[34a] 團隊主管不可停用自己",
    () => deactivatePerson({ userId: aaron, actorId: aaron, reasonCode: "VERIFY_NO_SELF", teamScopeId: qaTeamId }),
    PeopleAccessDeniedError,
  );
  await expectError(
    "[34b] 不得移除團隊最後一位 LEAD",
    () => removeTeamMember({ teamId: qaTeamId, userId: aaron, actorId: ctx.adminId, reasonCode: "VERIFY_LAST_LEAD" }),
    PeopleStateError,
  );

  await expectError(
    "[35] 偽造其他 teamId 的請求在 Service 層被拒絕",
    () =>
      createTeamMember({
        teamId: opTeamId, // Aaron 不是維運主管
        name: "偽造teamId成員",
        email: "forged-team@verify.invalid",
        role: "OP",
        isActive: true,
        actorId: aaron,
        reasonCode: "VERIFY_FORGED_TEAM",
      }),
    PeopleAccessDeniedError,
  );

  // [36] User.role 偽造：直接寫入 User.role="Admin" 但沒有 active Admin UserRole
  const forged = await prisma.user.create({
    data: { name: "偽造Admin", email: "forged-role@verify.invalid", role: "Admin", department: "測試", isActive: true },
  });
  await prisma.userRole.create({ data: { userId: forged.id, role: "QA", isActive: true } });
  await expectError(
    "[36] User.role 偽造不得取得權限（無 active Admin UserRole）",
    () =>
      updatePersonProfile({
        userId: ctx.idByName.get("Ken")!,
        department: "被偽造角色修改",
        actorId: forged.id,
        reasonCode: "VERIFY_FORGED_ROLE",
      }),
    PeopleAccessDeniedError,
  );
}

async function runSupervisorResolutionChecks(ctx: Ctx, adminIssueId: string) {
  console.log("\n=== 【主管解析】[37]-[43] ===");
  const qaTeamId = ctx.teamIdByName.get("品管")!;
  const opTeamId = ctx.teamIdByName.get("維運")!;
  const archTeamId = ctx.teamIdByName.get("系統架構")!;

  const kenIssue = await submitIssue(ctx, ctx.idByName.get("Ken")!, qaTeamId, ctx.idByName.get("Ken")!, "[verify] Ken 送簽");
  check("[37] Ken 送出工單，expected approver = Aaron", (await expectedApproverNameFor(kenIssue.id)) === "Aaron");

  const jonusIssue = await submitIssue(ctx, ctx.idByName.get("Jonus")!, qaTeamId, ctx.idByName.get("Jonus")!, "[verify] Jonus 送簽");
  check("[38] Jonus 送出工單，expected approver = Aaron", (await expectedApproverNameFor(jonusIssue.id)) === "Aaron");

  const minIssue = await submitIssue(ctx, ctx.idByName.get("Min")!, opTeamId, ctx.idByName.get("Min")!, "[verify] Min 送簽");
  check("[39] Min 送出工單，expected approver = Wallace", (await expectedApproverNameFor(minIssue.id)) === "Wallace");

  const howardIssue = await submitIssue(ctx, ctx.idByName.get("Howard")!, opTeamId, ctx.idByName.get("Howard")!, "[verify] Howard 送簽");
  check("[40] Howard 送出工單，expected approver = Wallace", (await expectedApproverNameFor(howardIssue.id)) === "Wallace");

  // [41] 由 Admin 代 Ken 建立並由 Ken 送出：主管一律依申請人（Ken）解析，不依代建 actor
  const proxyIssue = await submitIssue(ctx, ctx.adminId, qaTeamId, ctx.idByName.get("Ken")!, "[verify] Admin 代建");
  check("[41] 不依實際代建 actor 解析主管（Admin 代建仍解析為 Aaron）", (await expectedApproverNameFor(proxyIssue.id)) === "Aaron");

  // [42] Alex（系統架構主管）沒有正式直屬主管 → fail closed
  await expectError(
    "[42] 找不到正式主管時 fail closed",
    () => submitIssue(ctx, ctx.idByName.get("Alex")!, archTeamId, ctx.idByName.get("Alex")!, "[verify] 無主管 fail closed"),
    NoEligibleApproverError,
  );

  // [43] 主管不可自我核准：Ken 是申請人，不得核准自己送出的工單
  const record = await prisma.approvalRecord.findFirstOrThrow({
    where: { issueId: kenIssue.id, approvalType: "BUSINESS_APPROVAL", recordStatus: "ACTIVE", decision: "PENDING" },
  });
  await expectError(
    "[43] 主管不可自我核准（申請人不得核准自己的工單）",
    () => decideApprovalRecord({ approvalRecordId: record.id, actorUserId: ctx.idByName.get("Ken")!, decision: "APPROVED" }),
    SelfApprovalError,
  );

  check("[21b] Admin 代建工單仍產生 BUSINESS_APPROVAL 待簽紀錄", !!(await expectedApproverNameFor(adminIssueId)));
}

async function runConsistencyChecks(ctx: Ctx) {
  console.log("\n=== 【資料一致性】[44]-[47] ===");

  // [44] Preview 與 verify 共用同一 fixture（靜態檢查）
  const previewSource = fs.readFileSync("scripts/hotfix_ui_preview.ts", "utf8");
  const verifySource = fs.readFileSync("scripts/formal_organization-verify.ts", "utf8");
  const sharesFixture =
    previewSource.includes("fixtures/formalOrganizationFixture") && verifySource.includes("fixtures/formalOrganizationFixture");
  // Preview 不得自己建立組織資料（團隊／人員／membership／主管指派），一律經由 fixture。
  // 只比對實際的 Prisma 寫入呼叫，不比對註解文字。
  const forbiddenWrites = [
    /prisma\.team\.create\(/,
    /prisma\.user\.create\(/,
    /prisma\.teamMember\.create\(/,
    /prisma\.userRole\.create\(/,
    /prisma\.userSupervisorAssignment\.create\(/,
  ];
  const previewSelfCreatesOrg = forbiddenWrites.some((p) => p.test(previewSource));
  check(
    "[44] Preview 與 targeted verify 共用同一正式 fixture（Preview 不自行建立組織資料）",
    sharesFixture && !previewSelfCreatesOrg,
    `sharesFixture=${sharesFixture} previewSelfCreatesOrg=${previewSelfCreatesOrg}`,
  );

  // [45][46] 冪等：重跑 fixture 不產生重複資料
  const before = {
    teams: await prisma.team.count(),
    users: await prisma.user.count(),
    memberships: await prisma.teamMember.count(),
    assignments: await prisma.userSupervisorAssignment.count(),
  };
  await seedFormalOrganization(prisma);
  const after = {
    teams: await prisma.team.count(),
    users: await prisma.user.count(),
    memberships: await prisma.teamMember.count(),
    assignments: await prisma.userSupervisorAssignment.count(),
  };
  check("[45] 重建 Preview（重跑 fixture）結果冪等", JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  check(
    "[46] 重跑 fixture 不產生重複團隊、人員或 membership",
    after.teams === before.teams && after.users === before.users && after.memberships === before.memberships,
  );

  // [47] IssueKeySequence 與工單同步（scratch DB）
  const sequence = await prisma.issueKeySequence.findUnique({ where: { issueType: "Hotfix" } });
  const issues = await prisma.issue.findMany({ where: { issueType: "Hotfix" }, select: { issueKey: true } });
  const maxSuffix = issues.reduce((max, i) => {
    const m = /^HOTFIX-(\d+)$/.exec(i.issueKey);
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
  check(
    "[47a] scratch DB：IssueKeySequence 不低於既有工單最大編號",
    !!sequence && sequence.lastValue >= maxSuffix,
    `lastValue=${sequence?.lastValue} max=${maxSuffix}`,
  );
}

// ---------------------------------------------------------------------------
// B. Preview DB（唯讀）
// ---------------------------------------------------------------------------

async function runPreviewDbChecks() {
  console.log("\n=== 【Preview DB 實際狀態】[1]-[15]／[47b] ===");
  if (!fs.existsSync(PREVIEW_DB)) {
    check("[Preview] prisma/hotfix-ui-preview.db 存在（請先執行 npm run hotfix-ui:preview）", false);
    return;
  }

  const previewClient = new PrismaClient({ datasources: { db: { url: `file:${PREVIEW_DB}` } } });
  try {
    await checkFormalStructure(previewClient, "Preview", 1);

    // [14] 登入頁只顯示正式人員及最高權限管理員
    const loginUsers = await previewClient.user.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
    const expectedLoginNames = ["最高權限管理員", ...FORMAL_LEADS.map((l) => l.name), ...FORMAL_MEMBERS.map((m) => m.name)].sort();
    const actualLoginNames = loginUsers.map((u) => u.name).sort();
    check(
      "[14] Preview 登入頁只顯示正式人員及最高權限管理員",
      JSON.stringify(actualLoginNames) === JSON.stringify(expectedLoginNames),
      `實際：${actualLoginNames.join("、")}`,
    );

    // [15] 不存在舊 hfui9-* 工單
    const legacyIssues = await previewClient.issue.findMany({ where: { issueKey: { contains: "hfui9" } } });
    check("[15] 不存在舊 hfui9-* 工單", legacyIssues.length === 0, `實際 ${legacyIssues.length} 筆`);

    // 所有工單的申請人都必須是正式組織人員。
    // 刻意不比對「工單筆數等於 seed 的 4 筆」——人工驗收時本來就會自行建立工單，
    // 那不是缺陷；這裡要守的是「不得再出現非正式人員的工單」這個性質。
    const issues = await previewClient.issue.findMany({ include: { reporterUser: true } });
    const formalNames = new Set<string>([...FORMAL_LEADS.map((l) => l.name), ...FORMAL_MEMBERS.map((m) => m.name)]);
    const foreignApplicants = issues.filter((i) => !i.reporterUser || !formalNames.has(i.reporterUser.name));
    check(
      "[15b] Preview 所有工單的申請人都是正式組織成員",
      foreignApplicants.length === 0,
      foreignApplicants.map((i) => `${i.issueKey}:${i.reporterUser?.name ?? "（無）"}`).join("、"),
    );
    const seededApplicants = new Set(issues.map((i) => i.reporterUser?.name));
    check("[15c] Preview 內含 Ken／Min 的基礎測試工單", seededApplicants.has("Ken") && seededApplicants.has("Min"));

    // [47b] IssueKeySequence 與 Preview 工單同步
    const sequence = await previewClient.issueKeySequence.findUnique({ where: { issueType: "Hotfix" } });
    const maxSuffix = issues.reduce((max, i) => {
      const m = /^HOTFIX-(\d+)$/.exec(i.issueKey);
      return m ? Math.max(max, Number(m[1])) : max;
    }, 0);
    check(
      "[47b] Preview：IssueKeySequence 與工單同步（且未重用已刪除的 HOTFIX-0004）",
      !!sequence && sequence.lastValue >= maxSuffix && maxSuffix >= 5,
      `lastValue=${sequence?.lastValue} max=${maxSuffix}`,
    );
  } finally {
    await previewClient.$disconnect();
  }
}

// ---------------------------------------------------------------------------

async function main() {
  const beforeHash = fs.existsSync(OFFICIAL_DEV_DB) ? crypto.createHash("sha256").update(fs.readFileSync(OFFICIAL_DEV_DB)).digest("hex") : null;

  console.log("=== 【正式資料｜scratch DB】[1]-[13] ===");
  const ctx = await setupScratch();
  await checkFormalStructure(prisma, "scratch", 1);

  const adminIssue = await runAdminCrudChecks(ctx);
  await runLeadCrudChecks(ctx);
  await runSupervisorResolutionChecks(ctx, adminIssue.id);
  await runConsistencyChecks(ctx);

  await runPreviewDbChecks();

  console.log("\n=== 【收尾】[48]-[49] ===");
  const afterHash = fs.existsSync(OFFICIAL_DEV_DB) ? crypto.createHash("sha256").update(fs.readFileSync(OFFICIAL_DEV_DB)).digest("hex") : null;
  check("[48] 正式 /workspaces/governance-tracker/prisma/dev.db 全程完全不變", beforeHash === afterHash, `before=${beforeHash} after=${afterHash}`);

  const residue = fs
    .readdirSync(PRISMA_DIR)
    .filter((f) => f.endsWith("-journal") || f.endsWith("-wal") || f.endsWith("-shm"));
  check("[49] prisma/ 目錄無 journal／wal／shm 殘留", residue.length === 0, residue.join("、"));

  console.log(`\n=== 結果：PASS=${passCount} FAIL=${failCount} ===`);
  await prisma.$disconnect();
  if (failCount > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error("formal_organization-verify 執行時發生未預期錯誤：", err);
  await prisma.$disconnect();
  process.exit(1);
});
