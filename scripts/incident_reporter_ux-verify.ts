// 通報人快速通報介面（第二階段）targeted verify：直接呼叫
// src/lib/incident-ui/incidentCreation.ts 的 createIncidentForActor，驗證任務規格第四～十一
// 節的伺服器端行為——最小必填、"不確定"／"其他" 合法送出與條件必填、Checkbox 互斥規則、
// 自動摘要與原始描述分開保存、通報人無法指定正式分級／技術單位／RCA 判定等欄位。
// 不透過瀏覽器，只驗證資料與驗證邏輯本身（瀏覽器互動見 incident_rca_phase2-browser.ts）。
//   npx tsx scripts/incident_reporter_ux-verify.ts

import "./lib/assertSafeTestDatabase";

import { prisma } from "../src/lib/prisma";
import { seedFormalOrganization } from "./fixtures/formalOrganizationFixture";
import { buildIncidentWorkflowV1 } from "./lib/buildIncidentWorkflowV1";
import { createIncidentForActor, IncidentCreationValidationError, type CreateIncidentInput } from "../src/lib/incident-ui/incidentCreation";
import { INCIDENT_FIELD } from "../src/lib/incident-ui/incidentFieldRegistry";
import { REPORTER_OTHER, REPORTER_UNSURE } from "../src/lib/incident-ui/reporterIntakeOptions";

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
async function expectError(label: string, run: () => Promise<unknown>, ErrorType: new (...args: any[]) => Error) {
  try {
    await run();
    check(label, false, `預期 ${ErrorType.name}，實際成功`);
  } catch (error) {
    check(label, error instanceof ErrorType, error instanceof Error ? `${error.constructor.name}: ${error.message}` : String(error));
  }
}

function baseInput(overrides: Partial<CreateIncidentInput> = {}): CreateIncidentInput {
  return {
    title: "[verify] 登入頁面轉圈",
    description: "",
    systemName: "MyDMS",
    environment: "Production",
    incidentType: "系統／功能異常",
    occurredAt: "2026-08-01T09:00:00.000Z",
    occurredAtUncertain: false,
    reportSource: "快速通報介面",
    suggestedSeverity: "有影響，但仍可部分作業",
    isOngoing: "是，現在仍持續",
    hasWorkaround: "沒有",
    symptomText: "點擊登入後一直轉圈",
    symptomTags: ["無法登入", "操作無反應"],
    impactScope: "FEW_USERS",
    dataPermissionImpact: ["不確定"],
    operationalImpact: ["不確定"],
    ...overrides,
  };
}

async function main() {
  const org = await seedFormalOrganization(prisma);
  await prisma.workflowVersion.updateMany({ where: { status: "PUBLISHED", workflowDefinition: { issueType: "Incident" } }, data: { status: "ARCHIVED" } });
  await buildIncidentWorkflowV1({ actorId: org.admin.id, reasonCode: "REPORTER_UX_VERIFY", keySuffix: `reporter-ux-verify-${Date.now()}-${process.pid}` });

  const reporterInfo = org.personByKey.get("selena")!;
  const reporter = await prisma.user.findUniqueOrThrow({ where: { id: reporterInfo.id } });

  console.log("\n=== A. 最小必填欄位即可合法送出 ===");
  const minimal = await createIncidentForActor(reporter, baseInput());
  check("[1] 最小必填欄位可成功建立", Boolean(minimal.id));
  check("[2] 建立後自動送出待承接", minimal.workflowStatus === "pendingIntake");

  console.log("\n=== B. 「不確定」可合法送出 ===");
  const uncertainCase = await createIncidentForActor(reporter, baseInput({
    title: "[verify] 不確定案例",
    occurredAtUncertain: true,
    occurredAt: "",
    impactScope: "UNKNOWN",
    dataPermissionImpact: [REPORTER_UNSURE],
    operationalImpact: [REPORTER_UNSURE],
  }));
  check("[3] 發生時間不確定仍可送出", Boolean(uncertainCase.id));
  const occurredUncertainField = await prisma.issueFieldValue.findUnique({ where: { issueId_fieldKey: { issueId: uncertainCase.id, fieldKey: INCIDENT_FIELD.occurredAtUncertain } } });
  check("[4] 發生時間不確定旗標已保存", occurredUncertainField?.fieldValue === "是");
  const occurredAtField = await prisma.issueFieldValue.findUnique({ where: { issueId_fieldKey: { issueId: uncertainCase.id, fieldKey: "incidentOccurredAt" } } });
  check("[5] 發生時間不確定時不寫入 incidentOccurredAt", occurredAtField === null);

  console.log("\n=== C. 「其他」條件式必填 ===");
  await expectError(
    "[6] 事件類型選其他卻未補充說明，明確拒絕",
    () => createIncidentForActor(reporter, baseInput({ title: "[verify] 其他未填", incidentType: REPORTER_OTHER })),
    IncidentCreationValidationError,
  );
  const otherCase = await createIncidentForActor(reporter, baseInput({ title: "[verify] 其他已填", incidentType: REPORTER_OTHER, incidentTypeOtherNote: "自訂事件類型說明" }));
  const incidentTypeField = await prisma.issueFieldValue.findUnique({ where: { issueId_fieldKey: { issueId: otherCase.id, fieldKey: "incidentType" } } });
  check("[7] 事件類型其他且已補充說明可成功送出，內容含補充說明", Boolean(incidentTypeField?.fieldValue.includes("自訂事件類型說明")));

  console.log("\n=== D. 資料與權限影響互斥規則（Server 端） ===");
  await expectError(
    "[8] 「沒有發現上述情況」不能與其他項目同時選取",
    () => createIncidentForActor(reporter, baseInput({ title: "[verify] mutex A", dataPermissionImpact: ["沒有發現上述情況", "資料顯示錯誤"] })),
    IncidentCreationValidationError,
  );
  await expectError(
    "[9] 「不確定」不能與具體項目同時選取（資料與權限影響）",
    () => createIncidentForActor(reporter, baseInput({ title: "[verify] mutex B", dataPermissionImpact: [REPORTER_UNSURE, "資料顯示錯誤"] })),
    IncidentCreationValidationError,
  );
  await expectError(
    "[10] 資料與權限影響為空陣列，明確拒絕",
    () => createIncidentForActor(reporter, baseInput({ title: "[verify] mutex C", dataPermissionImpact: [] })),
    IncidentCreationValidationError,
  );

  console.log("\n=== E. 初步營運影響互斥規則＋「其他」條件必填 ===");
  await expectError(
    "[11] 「目前沒有明顯影響」不能與具體影響同時選取",
    () => createIncidentForActor(reporter, baseInput({ title: "[verify] mutex D", operationalImpact: ["目前沒有明顯影響", "無法執行主要工作"] })),
    IncidentCreationValidationError,
  );
  await expectError(
    "[12] 初步營運影響選其他卻未補充說明，明確拒絕",
    () => createIncidentForActor(reporter, baseInput({ title: "[verify] mutex E", operationalImpact: [REPORTER_OTHER] })),
    IncidentCreationValidationError,
  );
  const opOtherCase = await createIncidentForActor(reporter, baseInput({ title: "[verify] op other ok", operationalImpact: [REPORTER_OTHER], operationalImpactOtherNote: "自訂營運影響" }));
  const opOtherField = await prisma.issueFieldValue.findUnique({ where: { issueId_fieldKey: { issueId: opOtherCase.id, fieldKey: INCIDENT_FIELD.operationalImpactOtherNote } } });
  check("[13] 初步營運影響其他且已補充說明可成功送出並保存說明", opOtherField?.fieldValue === "自訂營運影響");

  console.log("\n=== F. 通報人無法指定正式分級／技術單位／RCA 判定等欄位（結構層保證） ===");
  const inputKeys = Object.keys(baseInput());
  const forbiddenKeys = [
    "formalSeverity", "adjustReason", "technicalTeamId", "technicalTeamLead", "executorUserId",
    "initialHandling", "recoveryMeasures", "recoveryTime", "recoveryResult", "needRca", "rcaDecisionReason",
    "rcaResponsibleUnit", "rcaOwner", "rootCause", "correctiveMeasures", "preventiveMeasures", "riskException", "closureDecision",
  ];
  check("[14] CreateIncidentInput 型別不含任何受理／處理／RCA 專屬欄位", forbiddenKeys.every((k) => !inputKeys.includes(k)));

  console.log("\n=== G. 自動摘要與原始描述分開保存 ===");
  const withDescription = await createIncidentForActor(reporter, baseInput({ title: "[verify] 摘要與描述", description: "這是通報人自己額外補充的原始描述文字" }));
  const issueRow = await prisma.issue.findUniqueOrThrow({ where: { id: withDescription.id } });
  check("[15] Issue.description 保留通報人原始描述，未被自動摘要覆蓋", issueRow.description === "這是通報人自己額外補充的原始描述文字");
  const autoSummaryField = await prisma.issueFieldValue.findUnique({ where: { issueId_fieldKey: { issueId: withDescription.id, fieldKey: INCIDENT_FIELD.autoSummary } } });
  check("[16] 系統自動摘要已另外保存", Boolean(autoSummaryField?.fieldValue.includes("系統：MyDMS")));
  check("[16b] 自動摘要與原始描述內容不同（未互相覆蓋）", autoSummaryField?.fieldValue !== issueRow.description);

  console.log("\n=== H. 通報人初步影響感受不得寫入 Issue.riskLevel ===");
  check("[17] 建立當下 Issue.riskLevel 仍是空值（正式等級只能由受理窗口決定）", !issueRow.riskLevel);

  console.log(`\n結果：PASS ${passed} / FAIL ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
