// Preview 測試資料建置腳本（正式組織版本，全面取代舊版 hfui9-* 九階段展示資料）。
//
// 舊版 Preview 為了展示九個階段而虛構了大量測試人員（填單人／RD執行人／IAD／AAD／
// QA第一組／OP第一組…）與示範工單（hfui9-*），已全部停止使用。本版只灌入
// scripts/fixtures/formalOrganizationFixture.ts 定義的正式組織資料，以及少量僅使用
// 正式人員的基礎測試工單。
//
// 目前尚未提供 RD 一般成員，因此刻意不建立任何進入 RD 執行階段的 Preview 工單——
// 沒有正式成員可指派時，強行製造完整執行流程只會再度產生虛構人員。最高權限管理員或
// 各團隊主管可從正式 UI（/admin/teams/[teamId]）自行建立成員後再執行完整人工流程測試。
//
// Fail-closed：第一行 import 為 assertSafeTestDatabase，拒絕連線到正式 prisma/dev.db。
//
// 使用方式：
//   npm run hotfix-ui:preview        # 重建 preview DB 並灌入正式組織測試資料
//   npm run dev:hotfix-ui-preview    # 啟動 dev server 指向該 DB，至 /login 選擇帳號登入

import "./lib/assertSafeTestDatabase";

import { prisma } from "../src/lib/prisma";
import { buildHotfixWorkflowV1 } from "./lib/buildHotfixWorkflowV1";
import { executeIssueTransition } from "../src/lib/workflowExecutionService";
import { saveHotfixDraft } from "../src/lib/hotfix-ui/draftService";
import { createIssueForActor } from "../src/lib/issueCreation";
import { synchronizeIssueKeySequencesFromExistingIssues } from "../src/lib/issue-key-sequence";
import {
  seedFormalOrganization,
  FORMAL_TEAMS,
  FORMAL_LEADS,
  FORMAL_MEMBERS,
  TEAMS_WITHOUT_MEMBERS,
} from "./fixtures/formalOrganizationFixture";

function buildCreateFormData(input: { title: string; description: string; teamId: string; applicantId: string }): FormData {
  const fd = new FormData();
  fd.set("issueType", "Hotfix");
  fd.set("title", input.title);
  fd.set("description", input.description);
  fd.set("systemName", "MyDMS");
  fd.set("environment", "Production");
  fd.set("riskLevel", "中");
  fd.set("dueDate", "2026-08-20");
  fd.set("hotfixPriority", "HIGH");
  fd.set("teamId", input.teamId);
  fd.set("applicantId", input.applicantId);
  return fd;
}

async function main() {
  console.log("=== 建立 Preview 正式組織測試資料 ===\n");

  console.log("[1/3] 建立正式組織（七個團隊、最高權限管理員、七位主管、六位一般成員）...");
  const org = await seedFormalOrganization(prisma);

  const requireTeam = (name: string) => {
    const id = org.teamIdByName.get(name);
    if (!id) throw new Error(`找不到團隊：${name}`);
    return id;
  };
  const requirePerson = (key: string) => {
    const person = org.personByKey.get(key);
    if (!person) throw new Error(`找不到人員：${key}`);
    return person;
  };

  console.log("[2/3] 發布 Hotfix v1 流程定義...");
  const hotfix = await buildHotfixWorkflowV1({
    actorId: org.admin.id,
    reasonCode: "PREVIEW_BUILD_HOTFIX_V1",
    keySuffix: "formal-org",
  });

  console.log("[3/3] 建立基礎測試工單（僅使用正式人員）...");

  // 本腳本不再寫入任何固定 issueKey 的工單，但仍先同步一次計數器：確保
  // createIssueForActor 的原子遞增起點與資料庫現況一致（重建後為空，同步為 no-op；
  // 若日後又混入固定 key 資料，這一行是必要的防撞號保護）。
  await synchronizeIssueKeySequencesFromExistingIssues(prisma);

  const qaTeamId = requireTeam("品管");
  const opTeamId = requireTeam("維運");
  const ken = requirePerson("ken");
  const min = requirePerson("min");
  const aaron = requirePerson("aaron");
  const wallace = requirePerson("wallace");

  const kenUser = await prisma.user.findUniqueOrThrow({ where: { id: ken.id } });
  const minUser = await prisma.user.findUniqueOrThrow({ where: { id: min.id } });

  // 1. Ken 的 Hotfix 草稿（停在第 1 關，尚未送出）
  const kenDraft = await createIssueForActor(
    kenUser,
    buildCreateFormData({
      title: "[Hotfix][MyDMS] 測試報表匯出欄位缺漏",
      description: "由品管成員 Ken 建立的草稿，尚未送出主管簽核。",
      teamId: qaTeamId,
      applicantId: ken.id,
    }),
  );

  // 2. Ken 正式送簽，停在第 2 關「申請人直屬主管簽核」，等待 Aaron 核准
  const kenSubmitted = await createIssueForActor(
    kenUser,
    buildCreateFormData({
      title: "[Hotfix][MyDMS] 測試案例執行紀錄未儲存",
      description: "由品管成員 Ken 建立並正式送出，等待直屬主管 Aaron 簽核。",
      teamId: qaTeamId,
      applicantId: ken.id,
    }),
  );
  await saveHotfixDraft({ issueId: kenSubmitted.id, actorId: ken.id, fields: { hotfixPriority: "HIGH", dueDate: "2026-08-20" } });
  {
    const submitT = await prisma.workflowTransition.findFirstOrThrow({
      where: { workflowVersionId: hotfix.version.id, fromStageId: hotfix.stageIds.draft, actionKey: "submit" },
    });
    await executeIssueTransition({ issueId: kenSubmitted.id, transitionId: submitT.id, actorId: ken.id, reasonCode: "PREVIEW_SUBMIT" });
  }

  // 3. Min 的 Hotfix 草稿
  const minDraft = await createIssueForActor(
    minUser,
    buildCreateFormData({
      title: "[Hotfix][MyDMS] 排程作業執行紀錄缺漏",
      description: "由維運成員 Min 建立的草稿，尚未送出主管簽核。",
      teamId: opTeamId,
      applicantId: min.id,
    }),
  );

  // 4. Min 正式送簽，停在第 2 關，等待 Wallace 核准
  const minSubmitted = await createIssueForActor(
    minUser,
    buildCreateFormData({
      title: "[Hotfix][MyDMS] 監控告警未依規則通知",
      description: "由維運成員 Min 建立並正式送出，等待直屬主管 Wallace 簽核。",
      teamId: opTeamId,
      applicantId: min.id,
    }),
  );
  await saveHotfixDraft({ issueId: minSubmitted.id, actorId: min.id, fields: { hotfixPriority: "HIGH", dueDate: "2026-08-20" } });
  {
    const submitT = await prisma.workflowTransition.findFirstOrThrow({
      where: { workflowVersionId: hotfix.version.id, fromStageId: hotfix.stageIds.draft, actionKey: "submit" },
    });
    await executeIssueTransition({ issueId: minSubmitted.id, transitionId: submitT.id, actorId: min.id, reasonCode: "PREVIEW_SUBMIT" });
  }

  // -------------------------------------------------------------------------
  // 人工測試資訊
  // -------------------------------------------------------------------------

  console.log("\n========================================");
  console.log("Preview 人工測試資訊");
  console.log("========================================");

  console.log("\n【最高權限管理員】");
  console.log(`  ${org.admin.name}（${org.admin.email}）`);
  console.log("  可測試：全部七個團隊與成員 CRUD（新增／編輯／角色／直屬主管／啟用／停用／移除／永久刪除）");

  console.log("\n【團隊主管】（各自只能管理自己團隊的成員，其他團隊唯讀）");
  for (const lead of FORMAL_LEADS) {
    console.log(`  ${lead.name}：${lead.teamName}成員 CRUD`);
  }

  console.log("\n【一般成員】");
  for (const member of FORMAL_MEMBERS) {
    const supervisor = FORMAL_LEADS.find((l) => l.key === member.supervisorKey);
    console.log(`  ${member.name}（${member.teamName}，直屬主管：${supervisor?.name ?? "未設定"}）`);
  }

  console.log("\n【團隊與領域】");
  for (const team of FORMAL_TEAMS) {
    const lead = FORMAL_LEADS.find((l) => l.teamName === team.name);
    const memberNames = FORMAL_MEMBERS.filter((m) => m.teamName === team.name).map((m) => m.name);
    console.log(
      `  ${team.name}（domain=${team.domain}）｜主管：${lead?.name ?? "—"}｜成員：${memberNames.length > 0 ? memberNames.join("、") : "（本輪未提供）"}`,
    );
  }
  console.log(`  註：${TEAMS_WITHOUT_MEMBERS.join("、")} 目前只有主管，尚未提供一般成員；可由主管或最高權限管理員從 UI 自行建立後再測完整流程。`);

  console.log("\n【可測試工單】");
  console.log(`  Ken 草稿：${kenDraft.issueKey}（以 Ken 登入 → 可編輯、可送出）`);
  console.log(`  Ken 待 ${aaron.name} 核准：${kenSubmitted.issueKey}（以 ${aaron.name} 登入 → 第 2 關「同意／駁回」）`);
  console.log(`  Min 草稿：${minDraft.issueKey}（以 Min 登入 → 可編輯、可送出）`);
  console.log(`  Min 待 ${wallace.name} 核准：${minSubmitted.issueKey}（以 ${wallace.name} 登入 → 第 2 關「同意／駁回」）`);

  console.log("\n登入方式：npm run dev:hotfix-ui-preview 後開啟 /login，於清單中點選帳號即可登入。\n");
}

main()
  .catch((err) => {
    console.error("建立 Preview 正式組織測試資料時發生錯誤：", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
