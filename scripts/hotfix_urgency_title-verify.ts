import "./lib/assertSafeTestDatabase";

import * as fs from "node:fs";
import * as crypto from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { createIssueForActor } from "../src/lib/issueCreation";
import {
  HOTFIX_PRIORITIES,
  HOTFIX_PRIORITY_FIELD_KEY,
  HOTFIX_URGENCY_GOVERNANCE,
  resolveHotfixPriority,
} from "../src/lib/hotfix-ui/priority";
import { hotfixTitleForDisplay, normalizeHotfixTitleForStorage } from "../src/lib/hotfix-ui/title";

const OFFICIAL_DEV_DB = "/workspaces/governance-tracker/prisma/dev.db";
let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? `（${detail}）` : ""}`);
  }
}

function hash(path: string): string | null {
  return fs.existsSync(path) ? crypto.createHash("sha256").update(fs.readFileSync(path)).digest("hex") : null;
}

async function main() {
  console.log("=== Hotfix title / urgency targeted verify ===");
  const beforeHash = hash(OFFICIAL_DEV_DB);
  const schema = fs.readFileSync("prisma/schema.prisma", "utf8");
  check("[1] Schema 確認沒有 IssueRelation／RelatedIssue，關聯功能依限制停止", !/model\s+(IssueRelation|RelatedIssue)\b/.test(schema));

  check("[2] 正式儲存標題會移除一個或多個舊 UI 前綴", normalizeHotfixTitleForStorage("[Hotfix][Hotfix]  登入失敗") === "登入失敗");
  check("[3] 清單 UI 前綴永遠只顯示一次", hotfixTitleForDisplay("[Hotfix] 登入失敗") === "[Hotfix] 登入失敗");
  check("[4] 四級緊急程度值域與文字正確", HOTFIX_PRIORITIES.map((item) => item.label).join(",") === "最高,高,低,最低");
  check("[5] 四級顏色皆有獨立 dot class", new Set(HOTFIX_PRIORITIES.map((item) => item.dotClass)).size === 4);
  check("[6] 四級 Tooltip 定義完整", HOTFIX_PRIORITIES.every((item) => item.description.length > 25));
  check("[7] 治理說明明確排除主管／VIP 身分作為提高依據", HOTFIX_URGENCY_GOVERNANCE.includes("VIP") && HOTFIX_URGENCY_GOVERNANCE.includes("不得僅因"));
  check("[8] 舊資料缺值依既有 P1-P4 映射且無值時有安全預設", resolveHotfixPriority(null, "P1").value === "HIGHEST" && resolveHotfixPriority(null, "").value === "HIGH");

  const ken = await prisma.user.findFirstOrThrow({ where: { email: "ken@formal-org.example.invalid", isActive: true } });
  const membership = await prisma.teamMember.findFirstOrThrow({ where: { userId: ken.id, isActive: true }, select: { teamId: true } });
  const form = new FormData();
  form.set("issueType", "Hotfix");
  form.set("title", "[Hotfix][Hotfix] 正式標題只存問題內容");
  form.set("description", "建立頁標題與緊急程度 targeted verify");
  form.set("systemName", "MyDMS");
  form.set("environment", "Production");
  form.set("riskLevel", "低");
  form.set("priority", "P4");
  form.set("hotfixPriority", "LOWEST");
  form.set("dueDate", "2026-12-31");
  form.set("teamId", membership.teamId);
  form.set("applicantId", ken.id);
  const created = await createIssueForActor(ken, form, { submitForApproval: false });
  const urgencyRow = await prisma.issueFieldValue.findUnique({
    where: { issueId_fieldKey: { issueId: created.id, fieldKey: HOTFIX_PRIORITY_FIELD_KEY } },
  });
  check("[9] Server 實際建立的 Hotfix 標題不保存 UI 前綴", created.title === "正式標題只存問題內容", created.title);
  check("[10] Server 實際保存四級緊急程度正式值", urgencyRow?.fieldValue === "LOWEST" && urgencyRow.fieldLabel === "緊急程度");

  const createSource = fs.readFileSync("src/components/NewIssueForm.tsx", "utf8");
  const tableSource = fs.readFileSync("src/components/IssueTable.tsx", "utf8");
  const listSource = fs.readFileSync("src/app/issues/page.tsx", "utf8");
  check("[11] 建立頁不再要求輸入 [Hotfix] placeholder", !createSource.includes("[Hotfix][系統名稱]") && createSource.includes("請輸入實際問題標題"));
  check("[12] 選最低顯示非阻擋季度上版提醒", createSource.includes("此項目原則上可評估改走季度上版"));
  check("[13] 緊急程度 Badge 同時有文字、aria-label 與 Hover title", tableSource.includes("緊急程度：") && tableSource.includes("aria-label") && tableSource.includes("title={urgency.description}"));

  const headers = ["緊急程度", "工單編號", "工單類型", "系統名稱", "標題", "申請人", "到期日", "目前階段", "承接團隊", "執行人", "等待角色", "操作"];
  const headerPositions = headers.map((header) => tableSource.indexOf(`>${header}</th>`));
  check("[14] Hotfix 清單欄位順序正確且第一欄為緊急程度", headerPositions.every((position, index) => position >= 0 && (index === 0 || position > headerPositions[index - 1])));
  check("[15] 過長標題省略並提供 Tooltip", tableSource.includes('title={displayTitle}') && tableSource.includes("truncate"));
  check("[16] 搜尋直接比對正式儲存的 issue.title", listSource.includes("issue.title.toLocaleLowerCase"));
  check("[17] Hotfix／季度專案／事件通報／RCA 保留四個獨立清單入口", ["Hotfix", "季度專案", "事件通報", "RCA"].every((label) => listSource.includes(`label: "${label}"`)));
  check("[18] 正式 dev.db 雜湊未修改", beforeHash === hash(OFFICIAL_DEV_DB));

  await prisma.$disconnect();
  console.log(`\n結果：PASS ${passed} / FAIL ${failed}`);
  if (failed) process.exit(1);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
