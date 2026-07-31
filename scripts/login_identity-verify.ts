import "./lib/assertSafeTestDatabase";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/prisma";
import {
  invalidateActorSession,
  parseActorSession,
  resolveActorSessionUser,
  SESSION_COOKIE_NAME,
} from "../src/lib/auth";
import { roleLabel } from "../src/lib/constants";
import { getUserEffectiveRoles, hasCapability } from "../src/lib/permissions";
import { resolveMemberManagementScope } from "../src/lib/peopleService";
import { resolveIssueCreationScope, listSelectableApplicants } from "../src/lib/team-applicant/issueCreationScope";
import { listActionableTasksForActor } from "../src/lib/workflowExecutionService";

const ROOT = process.cwd();
const BASE_URL = process.env.LOGIN_VERIFY_BASE_URL;
const ACCOUNT_NAMES = ["小新", "Aaron", "Yonnve", "Ken", "Wallace", "最高權限管理員"] as const;
const SWITCH_NAMES = ["小新", "Aaron", "最高權限管理員", "Ken"] as const;

interface LoginResult {
  cookieValue: string;
  actorId: string;
  html: string;
  role: string;
  department: string;
}

function source(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function actionIdForUser(html: string, userId: string): string {
  const form = Array.from(html.matchAll(/<form\b[\s\S]*?<\/form>/g))
    .map((match) => match[0])
    .find((candidate) => candidate.includes(`name="userId" value="${userId}"`));
  assert.ok(form, `登入頁必須有 user.id=${userId} 的獨立表單`);
  const action = form.match(/name="(\$ACTION_ID_[^"]+)"/);
  assert.ok(action, `user.id=${userId} 的 progressive Server Action identifier 不得缺少`);
  return action[1];
}

function setCookieValues(headers: Headers): string[] {
  const withGetter = headers as Headers & { getSetCookie?: () => string[] };
  return withGetter.getSetCookie?.() ?? [headers.get("set-cookie") ?? ""];
}

function actorCookieFrom(headers: Headers): string {
  const cookie = setCookieValues(headers).find((value) => value.startsWith(`${SESSION_COOKIE_NAME}=`));
  assert.ok(cookie, `Server Action 必須寫入 ${SESSION_COOKIE_NAME}`);
  const encoded = cookie.slice(SESSION_COOKIE_NAME.length + 1).split(";", 1)[0];
  return decodeURIComponent(encoded);
}

async function postLoginAction(actionId: string, userId: string) {
  assert.ok(BASE_URL);
  const body = new FormData();
  body.set(actionId, "");
  body.set("userId", userId);
  return fetch(`${BASE_URL}/login`, {
    method: "POST",
    headers: { Origin: new URL(BASE_URL).origin },
    body,
    redirect: "manual",
  });
}

async function loginAndVerify(name: string): Promise<LoginResult> {
  assert.ok(BASE_URL, "LOGIN_VERIFY_BASE_URL 必填，測試不得退化為純靜態搜尋");
  const matches = await prisma.user.findMany({
    where: { name, isActive: true },
    include: {
      userRoles: { where: { isActive: true }, orderBy: { createdAt: "asc" } },
      teamMemberships: { where: { isActive: true }, include: { team: true } },
    },
  });
  assert.equal(matches.length, 1, `帳號「${name}」必須唯一對應一個 active User`);
  const expected = matches[0];

  const loginPage = await fetch(`${BASE_URL}/login`, { cache: "no-store" });
  assert.equal(loginPage.status, 200);
  const loginHtml = await loginPage.text();
  const expectedDepartment = expected.teamMemberships.map((membership) => membership.team.name).join("、") || "—";
  assert.ok(loginHtml.includes(`${expected.email} · ${expectedDepartment} ·`), `${name} 登入選項的部門必須使用 Team 名稱`);
  const actionId = actionIdForUser(loginHtml, expected.id);
  const response = await postLoginAction(actionId, expected.id);
  assert.equal(response.status, 303, `${name} progressive login 應 redirect`);

  const cookieValue = actorCookieFrom(response.headers);
  const session = parseActorSession(cookieValue);
  assert.equal(session?.actorId, expected.id, `${name} Session actorId 必須等於所選 user.id`);
  assert.equal((await resolveActorSessionUser(cookieValue))?.id, expected.id, `${name} requireCurrentUser 共用還原路徑必須回傳同一 user.id`);

  const authenticated = await fetch(`${BASE_URL}/governance`, {
    headers: { Cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(cookieValue)}` },
    cache: "no-store",
  });
  assert.equal(authenticated.status, 200);
  const html = await authenticated.text();
  assert.ok(html.includes(`data-session-actor-id="${expected.id}"`), `${name} Root Layout actorId 不得錯置`);
  assert.ok(html.includes(`data-session-actor-name="${expected.name}"`), `${name} Topbar 姓名不得錯置`);

  const roles = await getUserEffectiveRoles(expected);
  assert.deepEqual(new Set(roles), new Set(expected.userRoles.map((row) => row.role)), `${name} 權限角色只來自 active UserRole`);
  const managementScope = await resolveMemberManagementScope(expected.id);
  const renderedRole = `${roles.map(roleLabel).join("、") || "未指派角色"}${managementScope.ledTeamIds.length > 0 ? " Lead" : ""}`;
  assert.ok(html.includes(renderedRole), `${name} Topbar 角色必須由 active UserRole／Lead 關係顯示`);

  const canUseWorkManagement = hasCapability(roles, "issue.view");
  assert.equal(html.includes('href="/work-management"'), canUseWorkManagement, `${name} Sidebar visibility 必須符合 active UserRole`);
  const tasks = await listActionableTasksForActor(expected.id);
  const bellLabel = tasks.length > 0 ? `待我處理，共 ${tasks.length} 筆` : "待我處理，目前沒有待辦";
  assert.ok(html.includes(bellLabel), `${name} 通知待辦必須屬於 Session actor`);
  if (tasks.length > 0) assert.ok(html.includes(`${tasks.length} 件待辦`), `${name} 我的待辦與通知 Badge 數量必須一致`);

  const creationScope = await resolveIssueCreationScope(expected.id);
  if (creationScope.kind === "MEMBER") {
    assert.equal(creationScope.fixedApplicant?.id, expected.id, `${name} 一般成員建立事項申請人必須固定為本人`);
  } else if (creationScope.kind === "TEAM_LEAD" && creationScope.fixedTeamId) {
    const applicants = await listSelectableApplicants(expected.id, creationScope.fixedTeamId);
    assert.ok(applicants.some((applicant) => applicant.id === expected.id), `${name} 主管建立範圍必須包含本人且不得殘留前一 actor`);
  } else {
    assert.equal(creationScope.kind, "ADMIN", `${name} 建立範圍必須由實際 actor 推導`);
    assert.equal(creationScope.fixedApplicant, null, "Admin 不得殘留前一帳號的固定申請人");
  }

  return { cookieValue, actorId: expected.id, html, role: renderedRole, department: expectedDepartment };
}

async function invalidateAndVerify(cookieValue: string, name: string) {
  assert.equal(await invalidateActorSession(cookieValue), true, `${name} 登出必須撤銷目前 Session version`);
  assert.equal(await resolveActorSessionUser(cookieValue), null, `${name} 登出後舊 Session 必須失效`);
}

async function main() {
  assert.ok(BASE_URL, "請以 LOGIN_VERIFY_BASE_URL 指向已啟動的隔離 Preview");
  const authActions = source("src/lib/authActions.ts");
  const loginForm = source("src/app/login/LoginUserForm.tsx");
  assert.ok(authActions.includes("findUnique({ where: { id: userId } })"), "登入必須以唯一 user.id 查找");
  assert.ok(!/findFirst\s*\(/.test(authActions), "登入不得使用 findFirst");
  assert.ok(!/user(?:s)?\s*\[0\]|\.at\(0\)/i.test(authActions), "登入不得 fallback 至第一個帳號");
  assert.ok(loginForm.includes('name="userId" value={userId}'), "登入選項 value 必須是 user.id");
  assert.ok(loginForm.includes('window.location.replace("/governance")'), "登入後必須重新載入 Root Layout");

  const rows: Array<Record<string, string>> = [];
  for (const name of ACCOUNT_NAMES) {
    const result = await loginAndVerify(name);
    rows.push({ 登入帳號: name, "Session actor": result.actorId, 畫面姓名: name, 角色: result.role, 部門: result.department, 結果: "PASS" });
    await invalidateAndVerify(result.cookieValue, name);
  }

  let previousActorId: string | null = null;
  for (const name of SWITCH_NAMES) {
    const result = await loginAndVerify(name);
    assert.notEqual(result.actorId, previousActorId, `${name} 登入後不得殘留前一人 actorId`);
    if (name === "最高權限管理員") {
      const roles = await getUserEffectiveRoles({ id: result.actorId });
      assert.ok(hasCapability(roles, "admin.full"), "只有最高權限管理員切換步驟應取得 Admin 能力");
    } else {
      const roles = await getUserEffectiveRoles({ id: result.actorId });
      assert.equal(hasCapability(roles, "admin.full"), false, `${name} 不得取得 Admin 能力`);
    }
    previousActorId = result.actorId;
    await invalidateAndVerify(result.cookieValue, name);
  }

  const loginHtml = await (await fetch(`${BASE_URL}/login`, { cache: "no-store" })).text();
  const validUsers = await prisma.user.findMany({ where: { name: "小新", isActive: true } });
  assert.equal(validUsers.length, 1);
  const invalidResponse = await postLoginAction(actionIdForUser(loginHtml, validUsers[0].id), "invalid-user-id");
  assert.equal(setCookieValues(invalidResponse.headers).some((value) => value.startsWith(`${SESSION_COOKIE_NAME}=`)), false, "查無 user.id 必須拒絕且不得建立 Session");

  console.table(rows);
  console.log(`PASS：六帳號登入 ${rows.length}/6；跨帳號切換 ${SWITCH_NAMES.join(" → ")}；舊 Session 全部失效。`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
