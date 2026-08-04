// M1.5-A1 驗證腳本
//
// 目的：驗證 M1.5-A1 核准治理層的邏輯正確性，並在 Migration 已套用的資料庫上
// （僅限測試資料庫，例如 prisma/dev-m1-5-test.db）實測服務層信任邊界與 DB 約束。
//
// - 純邏輯測試（permissions.ts / approvalService.ts / timeWindow.ts / approvalSnapshotSchemas.ts /
//   riskCheckTemplates.ts / constants.ts）：不依賴資料庫，必定執行。
// - DB 相依測試：若資料表尚未建立（Migration 尚未套用），標記為 SKIPPED，不視為失敗，
//   也不會嘗試自動套用 Migration。若資料表已存在，則會建立臨時測試資料（獨立 email/id，
//   不觸碰既有 User／Issue 業務資料），測試結束後於 finally 區塊清除。
//
// 執行方式：
//   DATABASE_URL="file:./<測試 scratch DB>" node_modules/.bin/tsx scripts/m1_5-verify.ts
//
// Fail-closed（C1-B 新增）：本檔第一行 import 為 assertSafeTestDatabase，若呼叫端未顯式
// 設定 DATABASE_URL，或其解析後（含 symlink／device+inode 比對）指向正式 prisma/dev.db，
// 一律立即 process.exit(1)，不建立 Prisma Client、不寫入任何資料。不再支援「不帶
// DATABASE_URL 執行、DB 區塊自動 SKIP」的舊用法。

import "./lib/assertSafeTestDatabase";

import {
  APPROVAL_TYPES,
  isApprovalType,
  APPROVAL_DECISIONS,
  isApprovalDecision,
  APPROVAL_RECORD_STATUSES,
  isApprovalRecordStatus,
  APPROVAL_AUTHORITY_TYPES,
  isApprovalAuthorityType,
  RISK_CHECK_ANSWERS,
  isRiskCheckAnswer,
} from "../src/lib/constants";
import { isWithinHalfOpenWindow, windowsOverlap } from "../src/lib/timeWindow";
import {
  getEffectiveSupervisor,
  wouldCreateSupervisorCycle,
  isValidDelegate,
  wouldCreateDelegationChainOrCycle,
  getEligibleApprovers,
  canApproveStage,
  assertNotSelfApproval,
  SelfApprovalError,
  roleNeverGrantsApprovalAuthority,
  type SupervisorAssignmentLike,
  type ApprovalDelegationLike,
} from "../src/lib/permissions";
import type { TeamMembershipLike, ApprovalAuthoritySource } from "../src/lib/permissions";
import {
  checkApprovalRecordConsistency,
  type ApprovalRecordConsistencyInput,
  assertAllRiskChecksAnswered,
  assertNoUnresolvedUnknownRisks,
  RiskCheckIncompleteError,
  UnresolvedUnknownRiskError,
  createPendingApprovalRecord,
  decideApprovalRecord,
  resubmitApprovalRecord,
  pickExpectedApproverUserId,
  ApprovalValidationError,
  ApprovalStateError,
  ApprovalAuthorityMismatchError,
  DuplicateActivePendingApprovalError,
  type DecideApprovalInput,
  type CreatePendingApprovalInput,
} from "../src/lib/approvalService";
import {
  buildApprovalSnapshot,
  parseApprovalSnapshot,
  stableStringify,
  computeSnapshotHash,
  ApprovalSnapshotValidationError,
  ApprovalSnapshotIntegrityError,
} from "../src/lib/approvalSnapshotSchemas";
import { RD_LEAD_APPROVAL_STAGE_KEY, getRiskCheckTemplate } from "../src/lib/riskCheckTemplates";
import { prisma } from "../src/lib/prisma";

let passCount = 0;
let failCount = 0;
let skipCount = 0;

function check(name: string, condition: boolean) {
  if (condition) {
    passCount++;
    console.log(`  PASS  ${name}`);
  } else {
    failCount++;
    console.log(`  FAIL  ${name}`);
  }
}

async function checkAsync(name: string, fn: () => Promise<boolean>) {
  try {
    check(name, await fn());
  } catch (err) {
    failCount++;
    console.log(`  FAIL  ${name} (未預期例外：${err instanceof Error ? err.message : String(err)})`);
  }
}

async function expectError(name: string, fn: () => Promise<unknown>, isExpected: (err: unknown) => boolean) {
  try {
    await fn();
    failCount++;
    console.log(`  FAIL  ${name}（未拋出任何錯誤）`);
  } catch (err) {
    if (isExpected(err)) {
      passCount++;
      console.log(`  PASS  ${name}`);
    } else {
      failCount++;
      console.log(`  FAIL  ${name}（拋出非預期錯誤：${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}）`);
    }
  }
}

function skip(name: string, reason: string) {
  skipCount++;
  console.log(`  SKIP  ${name} (${reason})`);
}

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-07-25T00:00:00.000Z");

function runPureLogicTests() {
  console.log("=== M1.5-A1 驗證：固定值域（src/lib/constants.ts） ===");

  check(
    "APPROVAL_TYPES 值域正確",
    APPROVAL_TYPES.length === 6 &&
      ["BUSINESS_APPROVAL", "RD_LEAD_APPROVAL", "QA_LEAD_APPROVAL", "DEPLOYMENT_APPROVAL", "RISK_EXCEPTION_APPROVAL", "INCIDENT_CLOSURE_CONFIRMATION"].every(
        (v) => (APPROVAL_TYPES as readonly string[]).includes(v),
      ),
  );
  check("isApprovalType：非法值拒絕", !isApprovalType("NOT_A_TYPE"));

  check(
    "APPROVAL_DECISIONS 值域正確",
    APPROVAL_DECISIONS.length === 4 &&
      ["PENDING", "APPROVED", "REJECTED", "CANCELLED"].every((v) => (APPROVAL_DECISIONS as readonly string[]).includes(v)),
  );
  check("isApprovalDecision：非法值拒絕", !isApprovalDecision("MAYBE"));

  check(
    "APPROVAL_RECORD_STATUSES 值域正確",
    APPROVAL_RECORD_STATUSES.length === 3 &&
      ["ACTIVE", "INVALIDATED", "SUPERSEDED"].every((v) => (APPROVAL_RECORD_STATUSES as readonly string[]).includes(v)),
  );
  check("isApprovalRecordStatus：非法值拒絕", !isApprovalRecordStatus("DELETED"));

  check(
    "APPROVAL_AUTHORITY_TYPES 值域正確",
    APPROVAL_AUTHORITY_TYPES.length === 3 &&
      ["DIRECT_SUPERVISOR", "TEAM_LEAD", "DELEGATE"].every((v) => (APPROVAL_AUTHORITY_TYPES as readonly string[]).includes(v)),
  );
  check("isApprovalAuthorityType：非法值拒絕", !isApprovalAuthorityType("SELF"));

  check(
    "RISK_CHECK_ANSWERS 值域正確",
    RISK_CHECK_ANSWERS.length === 3 && ["YES", "NO", "UNKNOWN"].every((v) => (RISK_CHECK_ANSWERS as readonly string[]).includes(v)),
  );
  check("isRiskCheckAnswer：非法值拒絕（null 不在字串值域內，需呼叫端另行判斷）", !isRiskCheckAnswer("MAYBE"));

  console.log("\n=== M1.5-A1 驗證：半開區間（src/lib/timeWindow.ts） ===");

  check("isWithinHalfOpenWindow：validFrom<=now 且 validUntil=null 恆有效", isWithinHalfOpenWindow(new Date(now.getTime() - DAY), null, now));
  check("isWithinHalfOpenWindow：now < validFrom 尚未生效", !isWithinHalfOpenWindow(new Date(now.getTime() + DAY), null, now));
  check(
    "isWithinHalfOpenWindow：now===validUntil 視為已失效（半開區間不含右端點）",
    !isWithinHalfOpenWindow(new Date(now.getTime() - DAY), now, now),
  );
  check(
    "windowsOverlap：舊區間 validUntil=T 與新區間 validFrom=T 交界不重疊",
    !windowsOverlap(new Date(now.getTime() - DAY), now, now, null),
  );
  check(
    "windowsOverlap：實際重疊區間判定為重疊",
    windowsOverlap(new Date(now.getTime() - DAY), new Date(now.getTime() + DAY), now, null),
  );

  console.log("\n=== M1.5-A1 驗證：主管循環（src/lib/permissions.ts） ===");

  const noAssignments: SupervisorAssignmentLike[] = [];
  check("getEffectiveSupervisor：無指派資料回傳 none", getEffectiveSupervisor(noAssignments, "u1", now).kind === "none");

  const singlePrimary: SupervisorAssignmentLike[] = [
    { id: "a1", userId: "u1", supervisorUserId: "u2", validFrom: new Date(now.getTime() - DAY), validUntil: null, isPrimary: true, isActive: true },
  ];
  const resolvedSupervisor = getEffectiveSupervisor(singlePrimary, "u1", now);
  check(
    "getEffectiveSupervisor：唯一有效 primary 正確解析",
    resolvedSupervisor.kind === "resolved" && resolvedSupervisor.assignment.supervisorUserId === "u2",
  );

  const multiplePrimaryAssignments: SupervisorAssignmentLike[] = [
    { id: "a1", userId: "u1", supervisorUserId: "u2", validFrom: new Date(now.getTime() - DAY), validUntil: null, isPrimary: true, isActive: true },
    { id: "a2", userId: "u1", supervisorUserId: "u3", validFrom: new Date(now.getTime() - DAY), validUntil: null, isPrimary: true, isActive: true },
  ];
  check(
    "getEffectiveSupervisor：多筆有效 primary 回傳 configError，不得任選其一",
    getEffectiveSupervisor(multiplePrimaryAssignments, "u1", now).kind === "configError",
  );

  const chain: SupervisorAssignmentLike[] = [
    { id: "a1", userId: "u1", supervisorUserId: "u2", validFrom: new Date(now.getTime() - DAY), validUntil: null, isPrimary: true, isActive: true },
    { id: "a2", userId: "u2", supervisorUserId: "u3", validFrom: new Date(now.getTime() - DAY), validUntil: null, isPrimary: true, isActive: true },
  ];
  check("wouldCreateSupervisorCycle：u3 若指派 u1 為主管會形成循環（u1→u2→u3→u1）", wouldCreateSupervisorCycle(chain, "u3", "u1", now));
  check("wouldCreateSupervisorCycle：u3 指派 u4 為主管不形成循環", !wouldCreateSupervisorCycle(chain, "u3", "u4", now));
  check("wouldCreateSupervisorCycle：自己指派自己恆視為循環", wouldCreateSupervisorCycle(chain, "u9", "u9", now));

  console.log("\n=== M1.5-A1 驗證：代理循環及轉委託（src/lib/permissions.ts） ===");

  const delegations: ApprovalDelegationLike[] = [
    {
      id: "d1",
      delegatorUserId: "sup1",
      delegateUserId: "sup2",
      teamId: null,
      approvalType: "BUSINESS_APPROVAL",
      validFrom: new Date(now.getTime() - DAY),
      validUntil: new Date(now.getTime() + DAY),
      isActive: true,
    },
  ];
  check("isValidDelegate：有效代理紀錄通過", isValidDelegate(delegations, "sup1", "sup2", "BUSINESS_APPROVAL", null, now));
  check("isValidDelegate：approvalType 不符拒絕", !isValidDelegate(delegations, "sup1", "sup2", "RD_LEAD_APPROVAL", null, now));
  check("isValidDelegate：teamId 不符拒絕", !isValidDelegate(delegations, "sup1", "sup2", "BUSINESS_APPROVAL", "team-x", now));

  check(
    "wouldCreateDelegationChainOrCycle：不支援代理人再次轉代理（sup2 已是同類型代理紀錄的 delegate）",
    wouldCreateDelegationChainOrCycle(delegations, "sup2", "sup3", "BUSINESS_APPROVAL", now),
  );
  check(
    "wouldCreateDelegationChainOrCycle：循環代理（sup2 委任回 sup1，形成 sup1→sup2→sup1）",
    wouldCreateDelegationChainOrCycle(delegations, "sup2", "sup1", "BUSINESS_APPROVAL", now),
  );
  check(
    "wouldCreateDelegationChainOrCycle：不同 approvalType 不受影響",
    !wouldCreateDelegationChainOrCycle(delegations, "sup2", "sup3", "QA_LEAD_APPROVAL", now),
  );
  check("wouldCreateDelegationChainOrCycle：委任人與代理人相同恆拒絕", wouldCreateDelegationChainOrCycle(delegations, "x", "x", "BUSINESS_APPROVAL", now));

  console.log("\n=== M1.5-A1 驗證：核准資格來源欄位組合（DIRECT_SUPERVISOR／TEAM_LEAD／DELEGATE） ===");

  const eligibleForBusiness = getEligibleApprovers({
    approvalType: "BUSINESS_APPROVAL",
    requestedByUserId: "u1",
    teamId: null,
    supervisorAssignments: [...singlePrimary],
    teamMemberships: [],
    delegations: [
      {
        id: "d2",
        delegatorUserId: "u2",
        delegateUserId: "u9",
        teamId: null,
        approvalType: "BUSINESS_APPROVAL",
        validFrom: new Date(now.getTime() - DAY),
        validUntil: new Date(now.getTime() + DAY),
        isActive: true,
      },
    ],
    now,
  });
  check(
    "getEligibleApprovers(BUSINESS_APPROVAL)：直屬主管本人為合格核准來源",
    eligibleForBusiness.some((e) => e.authorityType === "DIRECT_SUPERVISOR" && e.userId === "u2"),
  );
  check(
    "getEligibleApprovers(BUSINESS_APPROVAL)：主管的有效代理人亦為合格核准來源",
    eligibleForBusiness.some((e) => e.authorityType === "DELEGATE" && e.userId === "u9"),
  );

  const teamMemberships: TeamMembershipLike[] = [
    { teamId: "team-rd", userId: "lead1", membershipRole: "LEAD", isActive: true },
    { teamId: "team-rd", userId: "member1", membershipRole: "MEMBER", isActive: true },
  ];
  const eligibleForRdLead = getEligibleApprovers({
    approvalType: "RD_LEAD_APPROVAL",
    requestedByUserId: "rdExecutor1",
    teamId: "team-rd",
    supervisorAssignments: [],
    teamMemberships,
    delegations: [],
    now,
  });
  check(
    "getEligibleApprovers(RD_LEAD_APPROVAL)：團隊 LEAD 本人為合格核准來源",
    eligibleForRdLead.some((e) => e.authorityType === "TEAM_LEAD" && e.userId === "lead1"),
  );
  check(
    "getEligibleApprovers(RD_LEAD_APPROVAL)：一般 MEMBER 不具核准資格",
    !eligibleForRdLead.some((e) => e.userId === "member1"),
  );

  check(
    "canApproveStage：合格候選人回傳其資格來源",
    canApproveStage("lead1", eligibleForRdLead)?.authorityType === "TEAM_LEAD",
  );
  check("canApproveStage：非合格候選人回傳 null", canApproveStage("someone-else", eligibleForRdLead) === null);

  check(
    "Admin／資安推動小組角色本身不構成核准資格來源（getEligibleApprovers 不接受 role 參數，結構上不可能因角色自動放行）",
    roleNeverGrantsApprovalAuthority("Admin") && roleNeverGrantsApprovalAuthority("資安推動小組"),
  );
  const noAssignmentForAdmin = getEligibleApprovers({
    approvalType: "BUSINESS_APPROVAL",
    requestedByUserId: "adminUserWithoutAssignment",
    teamId: null,
    supervisorAssignments: [],
    teamMemberships: [],
    delegations: [],
    now,
  });
  check(
    "沒有實際 UserSupervisorAssignment 紀錄時，即使角色為 Admin 也不會出現任何合格核准人",
    noAssignmentForAdmin.length === 0,
  );

  console.log("\n=== M1.5-A1 驗證：expectedApproverUserId 多候選人語意（src/lib/approvalService.ts，純邏輯） ===");

  const singleCandidate: ApprovalAuthoritySource[] = [{ authorityType: "TEAM_LEAD", userId: "lead-x", teamId: "team-x" }];
  check("pickExpectedApproverUserId：唯一合格核准人時正確填入該人", pickExpectedApproverUserId(singleCandidate) === "lead-x");

  const twoLeads: ApprovalAuthoritySource[] = [
    { authorityType: "TEAM_LEAD", userId: "lead-a", teamId: "team-x" },
    { authorityType: "TEAM_LEAD", userId: "lead-b", teamId: "team-x" },
  ];
  check("pickExpectedApproverUserId：多位 TEAM_LEAD 時為 null", pickExpectedApproverUserId(twoLeads) === null);

  const leadPlusDelegate: ApprovalAuthoritySource[] = [
    { authorityType: "TEAM_LEAD", userId: "lead-a", teamId: "team-x" },
    { authorityType: "DELEGATE", userId: "delegate-a", approvalDelegationId: "d1", onBehalfOfUserId: "lead-a" },
  ];
  check("pickExpectedApproverUserId：LEAD 加代理人形成多候選時為 null", pickExpectedApproverUserId(leadPlusDelegate) === null);

  const reversedTwoLeads: ApprovalAuthoritySource[] = [twoLeads[1], twoLeads[0]];
  check(
    "pickExpectedApproverUserId：候選人順序改變不影響結果（正序與反序皆為 null）",
    pickExpectedApproverUserId(twoLeads) === pickExpectedApproverUserId(reversedTwoLeads),
  );
  const reversedLeadPlusDelegate: ApprovalAuthoritySource[] = [leadPlusDelegate[1], leadPlusDelegate[0]];
  check(
    "pickExpectedApproverUserId：候選人順序改變不影響結果（LEAD+代理人正序與反序皆為 null）",
    pickExpectedApproverUserId(leadPlusDelegate) === pickExpectedApproverUserId(reversedLeadPlusDelegate),
  );

  console.log("\n=== M1.5-A1 驗證：自行核准阻擋（src/lib/permissions.ts） ===");

  let selfApprovalThrew = false;
  try {
    assertNotSelfApproval("u1", "u1");
  } catch (e) {
    selfApprovalThrew = e instanceof SelfApprovalError;
  }
  check("assertNotSelfApproval：送核人與核准人相同時拋出 SelfApprovalError", selfApprovalThrew);

  let selfApprovalNotThrew = true;
  try {
    assertNotSelfApproval("u1", "u2");
  } catch {
    selfApprovalNotThrew = false;
  }
  check("assertNotSelfApproval：送核人與核准人不同時不拋出", selfApprovalNotThrew);

  console.log("\n=== M1.5-A3 驗證：決策欄位一致性（核准責任目標 vs 實際核准途徑分離，src/lib/approvalService.ts） ===");

  // 便於逐項覆寫的基準值：PENDING＋BUSINESS_APPROVAL 的合法狀態。
  const baseBusinessPending: ApprovalRecordConsistencyInput = {
    approvalType: "BUSINESS_APPROVAL",
    decision: "PENDING",
    recordStatus: "ACTIVE",
    decidedAt: null,
    approverUserId: null,
    approverTeamId: null,
    approvalAuthorityType: null,
    supervisorAssignmentId: "sa1",
    approvalDelegationId: null,
    delegatedFromUserId: null,
    decisionReasonCode: null,
    decisionComment: null,
    revisionNo: 1,
    supersedesApprovalRecordId: null,
    invalidatedAt: null,
    invalidationReason: null,
  };
  const baseTeamLeadPending: ApprovalRecordConsistencyInput = {
    ...baseBusinessPending,
    approvalType: "RD_LEAD_APPROVAL",
    approverTeamId: "team1",
    supervisorAssignmentId: null,
  };

  check("checkApprovalRecordConsistency：PENDING＋BUSINESS_APPROVAL＋只有 supervisorAssignmentId（核准責任目標）通過", checkApprovalRecordConsistency(baseBusinessPending).ok);
  check("checkApprovalRecordConsistency：PENDING＋RD_LEAD_APPROVAL＋只有 approverTeamId（核准責任目標）通過", checkApprovalRecordConsistency(baseTeamLeadPending).ok);

  check(
    "checkApprovalRecordConsistency：PENDING 卻有 decidedAt 視為不一致",
    !checkApprovalRecordConsistency({ ...baseBusinessPending, decidedAt: now }).ok,
  );
  check(
    "checkApprovalRecordConsistency：PENDING 卻有 approvalAuthorityType（實際核准途徑尚未發生）視為不一致",
    !checkApprovalRecordConsistency({ ...baseBusinessPending, approvalAuthorityType: "DIRECT_SUPERVISOR" }).ok,
  );
  check(
    "checkApprovalRecordConsistency：PENDING 卻有 approvalDelegationId 視為不一致",
    !checkApprovalRecordConsistency({ ...baseBusinessPending, approvalDelegationId: "ad1" }).ok,
  );
  check(
    "checkApprovalRecordConsistency：PENDING 卻有 delegatedFromUserId 視為不一致",
    !checkApprovalRecordConsistency({ ...baseBusinessPending, delegatedFromUserId: "u9" }).ok,
  );
  check(
    "checkApprovalRecordConsistency：PENDING 卻有 decisionReasonCode 視為不一致",
    !checkApprovalRecordConsistency({ ...baseBusinessPending, decisionReasonCode: "x" }).ok,
  );
  check(
    "checkApprovalRecordConsistency：PENDING 卻有 decisionComment 視為不一致",
    !checkApprovalRecordConsistency({ ...baseBusinessPending, decisionComment: "x" }).ok,
  );
  check(
    "checkApprovalRecordConsistency：BUSINESS_APPROVAL 缺 supervisorAssignmentId（核准責任目標）視為不一致，即使仍是 PENDING",
    !checkApprovalRecordConsistency({ ...baseBusinessPending, supervisorAssignmentId: null }).ok,
  );
  check(
    "checkApprovalRecordConsistency：BUSINESS_APPROVAL 卻填 approverTeamId 視為不一致",
    !checkApprovalRecordConsistency({ ...baseBusinessPending, approverTeamId: "team-x" }).ok,
  );
  check(
    "checkApprovalRecordConsistency：RD_LEAD_APPROVAL 缺 approverTeamId（核准責任目標）視為不一致，即使仍是 PENDING",
    !checkApprovalRecordConsistency({ ...baseTeamLeadPending, approverTeamId: null }).ok,
  );
  check(
    "checkApprovalRecordConsistency：RD_LEAD_APPROVAL 卻填 supervisorAssignmentId 視為不一致",
    !checkApprovalRecordConsistency({ ...baseTeamLeadPending, supervisorAssignmentId: "sa1" }).ok,
  );

  const decidedDirectSupervisor: ApprovalRecordConsistencyInput = {
    ...baseBusinessPending,
    decision: "APPROVED",
    decidedAt: now,
    approverUserId: "u2",
    approvalAuthorityType: "DIRECT_SUPERVISOR",
  };
  check("checkApprovalRecordConsistency：APPROVED＋DIRECT_SUPERVISOR 完整正確組合通過", checkApprovalRecordConsistency(decidedDirectSupervisor).ok);
  check(
    "checkApprovalRecordConsistency：APPROVED 卻 approvalAuthorityType=null（實際核准途徑必須已解析）視為不一致",
    !checkApprovalRecordConsistency({ ...decidedDirectSupervisor, approvalAuthorityType: null }).ok,
  );
  check(
    "checkApprovalRecordConsistency：APPROVED 缺 approverUserId 視為不一致",
    !checkApprovalRecordConsistency({ ...decidedDirectSupervisor, approverUserId: null }).ok,
  );
  check(
    "checkApprovalRecordConsistency：DIRECT_SUPERVISOR 同時填 approvalDelegationId 視為不一致（互斥）",
    !checkApprovalRecordConsistency({ ...decidedDirectSupervisor, approvalDelegationId: "ad1" }).ok,
  );
  check(
    "checkApprovalRecordConsistency：DIRECT_SUPERVISOR 同時填 delegatedFromUserId 視為不一致",
    !checkApprovalRecordConsistency({ ...decidedDirectSupervisor, delegatedFromUserId: "u9" }).ok,
  );

  const decidedBusinessDelegate: ApprovalRecordConsistencyInput = {
    ...baseBusinessPending,
    decision: "APPROVED",
    decidedAt: now,
    approverUserId: "u9",
    approvalAuthorityType: "DELEGATE",
    approvalDelegationId: "ad1",
    delegatedFromUserId: "u2",
    // supervisorAssignmentId 沿用 baseBusinessPending 的 "sa1"：業務代理核准後仍須保留，
    // 代表原始業務主管責任來源。
  };
  check(
    "checkApprovalRecordConsistency：業務代理核准後完整正確組合通過（supervisorAssignmentId 仍保留＋approvalDelegationId／delegatedFromUserId 正確）",
    checkApprovalRecordConsistency(decidedBusinessDelegate).ok,
  );
  check(
    "checkApprovalRecordConsistency：DELEGATE 缺 approvalDelegationId 視為不一致",
    !checkApprovalRecordConsistency({ ...decidedBusinessDelegate, approvalDelegationId: null }).ok,
  );
  check(
    "checkApprovalRecordConsistency：DELEGATE 缺 delegatedFromUserId 視為不一致",
    !checkApprovalRecordConsistency({ ...decidedBusinessDelegate, delegatedFromUserId: null }).ok,
  );

  const decidedTeamLead: ApprovalRecordConsistencyInput = {
    ...baseTeamLeadPending,
    decision: "APPROVED",
    decidedAt: now,
    approverUserId: "lead1",
    approvalAuthorityType: "TEAM_LEAD",
  };
  check("checkApprovalRecordConsistency：Team LEAD 直接核准後完整正確組合通過（approverTeamId 仍保留）", checkApprovalRecordConsistency(decidedTeamLead).ok);
  check(
    "checkApprovalRecordConsistency：TEAM_LEAD 同時填 approvalDelegationId 視為不一致",
    !checkApprovalRecordConsistency({ ...decidedTeamLead, approvalDelegationId: "ad1" }).ok,
  );

  const decidedTeamDelegate: ApprovalRecordConsistencyInput = {
    ...baseTeamLeadPending,
    decision: "APPROVED",
    decidedAt: now,
    approverUserId: "delegate1",
    approvalAuthorityType: "DELEGATE",
    approvalDelegationId: "ad2",
    delegatedFromUserId: "lead1",
    // approverTeamId 沿用 baseTeamLeadPending 的 "team1"：技術代理核准後仍須保留，代表核准責任團隊。
  };
  check(
    "checkApprovalRecordConsistency：技術代理核准後完整正確組合通過（approverTeamId 仍保留＋approvalDelegationId 正確）",
    checkApprovalRecordConsistency(decidedTeamDelegate).ok,
  );

  check(
    "checkApprovalRecordConsistency：INVALIDATED 但 decision 非 APPROVED 視為不一致",
    !checkApprovalRecordConsistency({
      ...decidedTeamLead,
      decision: "REJECTED",
      recordStatus: "INVALIDATED",
      invalidatedAt: now,
      invalidationReason: "reason",
    }).ok,
  );

  check(
    "checkApprovalRecordConsistency：SUPERSEDED 但 decision=APPROVED 視為不一致",
    !checkApprovalRecordConsistency({ ...decidedTeamLead, recordStatus: "SUPERSEDED" }).ok,
  );

  console.log("\n=== M1.5-A1 驗證：revision 取代鏈（src/lib/approvalService.ts） ===");

  check(
    "checkApprovalRecordConsistency：無 supersedesApprovalRecordId 時 revisionNo 必須為 1",
    !checkApprovalRecordConsistency({ ...baseTeamLeadPending, revisionNo: 2, supersedesApprovalRecordId: null }).ok,
  );
  check(
    "checkApprovalRecordConsistency：有 supersedesApprovalRecordId 時 revisionNo 必須 >1",
    !checkApprovalRecordConsistency({ ...baseTeamLeadPending, revisionNo: 1, supersedesApprovalRecordId: "prev-id" }).ok,
  );
  check(
    "checkApprovalRecordConsistency：正確的 revision 取代鏈組合通過",
    checkApprovalRecordConsistency({ ...baseTeamLeadPending, revisionNo: 2, supersedesApprovalRecordId: "prev-id" }).ok,
  );

  console.log("\n=== M1.5-A1 驗證：null／UNKNOWN 規則（src/lib/approvalService.ts + riskCheckTemplates.ts） ===");

  const rdTemplate = getRiskCheckTemplate(RD_LEAD_APPROVAL_STAGE_KEY) ?? [];
  const allAnsweredYes = rdTemplate.map((t) => ({ checkKey: t.checkKey, answer: "YES" }));
  let allAnsweredThrew = false;
  try {
    assertAllRiskChecksAnswered(RD_LEAD_APPROVAL_STAGE_KEY, allAnsweredYes);
  } catch {
    allAnsweredThrew = true;
  }
  check("assertAllRiskChecksAnswered：全部已填答時不拋出", !allAnsweredThrew);

  const missingOne = allAnsweredYes.slice(1);
  let missingThrew = false;
  try {
    assertAllRiskChecksAnswered(RD_LEAD_APPROVAL_STAGE_KEY, missingOne);
  } catch (e) {
    missingThrew = e instanceof RiskCheckIncompleteError;
  }
  check("assertAllRiskChecksAnswered：缺一項 checkKey 視為未完成（null 非可選答案）", missingThrew);

  const withNullAnswer = rdTemplate.map((t) => ({ checkKey: t.checkKey, answer: null as string | null }));
  let nullThrew = false;
  try {
    assertAllRiskChecksAnswered(RD_LEAD_APPROVAL_STAGE_KEY, withNullAnswer);
  } catch (e) {
    nullThrew = e instanceof RiskCheckIncompleteError;
  }
  check("assertAllRiskChecksAnswered：answer=null 視為尚未填答，拒絕送核", nullThrew);

  let unresolvedUnknownThrew = false;
  try {
    assertNoUnresolvedUnknownRisks([{ checkKey: "hasUnknownDependency", answer: "UNKNOWN", resolvedAt: null }]);
  } catch (e) {
    unresolvedUnknownThrew = e instanceof UnresolvedUnknownRiskError;
  }
  check("assertNoUnresolvedUnknownRisks：UNKNOWN 未 resolve 時拒絕核准", unresolvedUnknownThrew);

  let resolvedUnknownNotThrew = true;
  try {
    assertNoUnresolvedUnknownRisks([{ checkKey: "hasUnknownDependency", answer: "UNKNOWN", resolvedAt: now }]);
  } catch {
    resolvedUnknownNotThrew = false;
  }
  check("assertNoUnresolvedUnknownRisks：UNKNOWN 已 resolve 時不拋出", resolvedUnknownNotThrew);

  console.log("\n=== M1.5-A1 驗證：snapshot parse/hash（src/lib/approvalSnapshotSchemas.ts） ===");

  const businessSnapshotData = {
    issueKey: "HOTFIX-0001",
    stageKey: "pendingBusinessApproval",
    issueSummary: "summary",
    urgencyReason: "urgent",
    expectedBusinessImpact: "impact",
    reporterUserId: "u1",
    designatedConfirmerUserId: null,
    systemName: "MyDMS",
    environment: "Production",
    riskCheckSummary: null,
  };
  const built = buildApprovalSnapshot("BUSINESS_APPROVAL", businessSnapshotData);
  check("buildApprovalSnapshot：合法資料建立成功並回傳 json/hash/schemaVersion", built.json.length > 0 && built.hash.length === 64 && built.schemaVersion === 1);

  const parsedBack = parseApprovalSnapshot(built.json, built.hash);
  check(
    "parseApprovalSnapshot：hash 相符時可正確解析並還原內容",
    (parsedBack as { issueKey: string }).issueKey === "HOTFIX-0001",
  );

  let tamperedThrew = false;
  try {
    parseApprovalSnapshot(built.json, "0".repeat(64));
  } catch (e) {
    tamperedThrew = e instanceof ApprovalSnapshotIntegrityError;
  }
  check("parseApprovalSnapshot：hash 不符（遭竄改）時拒絕，不得靜默略過", tamperedThrew);

  let corruptJsonThrew = false;
  try {
    parseApprovalSnapshot("{not valid json", null);
  } catch (e) {
    corruptJsonThrew = e instanceof ApprovalSnapshotIntegrityError;
  }
  check("parseApprovalSnapshot：JSON 解析失敗時拒絕", corruptJsonThrew);

  let missingFieldThrew = false;
  try {
    buildApprovalSnapshot("BUSINESS_APPROVAL", { issueKey: "HOTFIX-0002" });
  } catch (e) {
    missingFieldThrew = e instanceof ApprovalSnapshotValidationError;
  }
  check("buildApprovalSnapshot：缺必要欄位時拒絕建立（deny-by-default）", missingFieldThrew);

  check(
    "stableStringify：鍵值排序穩定，物件鍵順序不同但內容相同時字串相同",
    stableStringify({ b: 1, a: 2 }) === stableStringify({ a: 2, b: 1 }),
  );
  check(
    "computeSnapshotHash：相同輸入雜湊值相同",
    computeSnapshotHash(stableStringify({ a: 1 })) === computeSnapshotHash(stableStringify({ a: 1 })),
  );

  let riskExceptionThrew = false;
  try {
    buildApprovalSnapshot("RISK_EXCEPTION_APPROVAL", {});
  } catch (e) {
    riskExceptionThrew = e instanceof ApprovalSnapshotValidationError;
  }
  check("buildApprovalSnapshot：RISK_EXCEPTION_APPROVAL 尚未定義 schema，本輪一律拒絕", riskExceptionThrew);
}

// ---------------------------------------------------------------------------
// DB 相依測試：建立臨時測試資料（獨立 id/email，不觸碰既有 User／Issue），
// 驗證 approvalService.ts 的信任邊界與 DB 約束，結束後於 finally 清除。
// ---------------------------------------------------------------------------

const RUN_TAG = `m15v${Date.now()}`;

interface Fixtures {
  userIds: string[];
  teamIds: string[];
  issueIds: string[];
  assignmentIds: string[];
  delegationIds: string[];
  approvalRecordIdsNewestFirst: string[];
}

// C1-B2：Active UserRole 是唯一授權來源，測試 fixture 建立 User 時同步建立對應的
// active UserRole（role 與 User.role 相同），確保既有以 role 字串驅動的測試情境在
// 授權來源切換後仍能通過。inactive User（本檔目前無此情境）仍可保留 active UserRole，
// 用來驗證「User 停用後即使角色仍 active，也不得通過 getCurrentUser／實際授權入口」。
async function createUser(name: string, role: string): Promise<{ id: string }> {
  const user = await prisma.user.create({ data: { name, email: `${RUN_TAG}-${name}@example.invalid`, role } });
  await prisma.userRole.create({ data: { userId: user.id, role, isActive: true } });
  return user;
}

async function runDbDependentTests(fx: Fixtures) {
  // --- 使用者 fixtures ---
  const reporter = await createUser("reporter", "PM");
  const supervisor = await createUser("supervisor", "DMS主管");
  const supervisor2 = await createUser("supervisor2", "DMS主管");
  const delegate = await createUser("delegate", "PM");
  const delegateExpired = await createUser("delegateExpired", "PM");
  const stranger = await createUser("stranger", "PM");
  const admin = await createUser("admin", "Admin");
  const secTeam = await createUser("secteam", "資安推動小組");
  const rdLead = await createUser("rdLead", "RD");
  const rdMember = await createUser("rdMember", "RD");
  const rdMember2 = await createUser("rdMember2", "RD");
  const rdDelegate = await createUser("rdDelegate", "RD");
  const rdDelegateExpired = await createUser("rdDelegateExpired", "RD");
  const otherLead = await createUser("otherLead", "RD");
  const reporterMulti = await createUser("reporterMulti", "PM");
  const reporterCycleA = await createUser("reporterCycleA", "PM");
  const reporterCycleB = await createUser("reporterCycleB", "PM");
  fx.userIds.push(
    reporter.id,
    supervisor.id,
    supervisor2.id,
    delegate.id,
    delegateExpired.id,
    stranger.id,
    admin.id,
    secTeam.id,
    rdLead.id,
    rdMember.id,
    rdMember2.id,
    rdDelegate.id,
    rdDelegateExpired.id,
    otherLead.id,
    reporterMulti.id,
    reporterCycleA.id,
    reporterCycleB.id,
  );

  // --- 團隊 fixtures ---
  const teamRd = await prisma.team.create({ data: { name: `${RUN_TAG}-team-rd` } });
  const teamOther = await prisma.team.create({ data: { name: `${RUN_TAG}-team-other` } });
  fx.teamIds.push(teamRd.id, teamOther.id);
  await prisma.teamMember.create({ data: { teamId: teamRd.id, userId: rdLead.id, membershipRole: "LEAD" } });
  await prisma.teamMember.create({ data: { teamId: teamRd.id, userId: rdMember.id, membershipRole: "MEMBER" } });
  await prisma.teamMember.create({ data: { teamId: teamRd.id, userId: rdMember2.id, membershipRole: "MEMBER" } });
  await prisma.teamMember.create({ data: { teamId: teamOther.id, userId: otherLead.id, membershipRole: "LEAD" } });

  // --- 主管指派 fixtures ---
  const assignment1 = await prisma.userSupervisorAssignment.create({
    data: {
      userId: reporter.id,
      supervisorUserId: supervisor.id,
      validFrom: new Date(Date.now() - 30 * DAY),
      isPrimary: true,
      createdByUserId: supervisor.id,
    },
  });
  fx.assignmentIds.push(assignment1.id);

  // --- 代理 fixtures ---
  const delegation1 = await prisma.approvalDelegation.create({
    data: {
      delegatorUserId: supervisor.id,
      delegateUserId: delegate.id,
      approvalType: "BUSINESS_APPROVAL",
      validFrom: new Date(Date.now() - DAY),
      validUntil: new Date(Date.now() + 30 * DAY),
      createdByUserId: supervisor.id,
    },
  });
  fx.delegationIds.push(delegation1.id);
  const delegationExpired = await prisma.approvalDelegation.create({
    data: {
      delegatorUserId: supervisor.id,
      delegateUserId: delegateExpired.id,
      approvalType: "BUSINESS_APPROVAL",
      validFrom: new Date(Date.now() - 10 * DAY),
      validUntil: new Date(Date.now() - 1 * DAY),
      createdByUserId: supervisor.id,
    },
  });
  fx.delegationIds.push(delegationExpired.id);
  const rdDelegation = await prisma.approvalDelegation.create({
    data: {
      delegatorUserId: rdLead.id,
      delegateUserId: rdDelegate.id,
      teamId: teamRd.id,
      approvalType: "RD_LEAD_APPROVAL",
      validFrom: new Date(Date.now() - DAY),
      validUntil: new Date(Date.now() + 30 * DAY),
      createdByUserId: rdLead.id,
    },
  });
  fx.delegationIds.push(rdDelegation.id);
  const rdDelegationExpired = await prisma.approvalDelegation.create({
    data: {
      delegatorUserId: rdLead.id,
      delegateUserId: rdDelegateExpired.id,
      teamId: teamRd.id,
      approvalType: "RD_LEAD_APPROVAL",
      validFrom: new Date(Date.now() - 10 * DAY),
      validUntil: new Date(Date.now() - 1 * DAY),
      createdByUserId: rdLead.id,
    },
  });
  fx.delegationIds.push(rdDelegationExpired.id);

  // --- Issue fixtures ---
  const issue1 = await prisma.issue.create({
    data: { issueKey: `${RUN_TAG}-HOTFIX-1`, issueType: "Hotfix", title: "verify issue 1", workflowStatus: "pendingBusinessApproval" },
  });
  const issueRd = await prisma.issue.create({
    data: {
      issueKey: `${RUN_TAG}-HOTFIX-2`,
      issueType: "Hotfix",
      title: "verify issue rd",
      workflowStatus: "rdInProgress",
      assignedTeamId: teamRd.id,
    },
  });
  const issueRdDelegate = await prisma.issue.create({
    data: {
      issueKey: `${RUN_TAG}-HOTFIX-3`,
      issueType: "Hotfix",
      title: "verify issue rd delegate",
      workflowStatus: "rdInProgress",
      assignedTeamId: teamRd.id,
    },
  });
  const issueRdExpiredDelegate = await prisma.issue.create({
    data: {
      issueKey: `${RUN_TAG}-HOTFIX-4`,
      issueType: "Hotfix",
      title: "verify issue rd expired delegate",
      workflowStatus: "rdInProgress",
      assignedTeamId: teamRd.id,
    },
  });
  const issueAdmin = await prisma.issue.create({
    data: { issueKey: `${RUN_TAG}-HOTFIX-5`, issueType: "Hotfix", title: "verify issue admin", workflowStatus: "pendingBusinessApproval" },
  });
  fx.issueIds.push(issue1.id, issueRd.id, issueRdDelegate.id, issueRdExpiredDelegate.id, issueAdmin.id);

  console.log("\n=== M1.5-A1 驗證：新表存在 ===");
  check("UserSupervisorAssignment 資料表可查詢", (await prisma.userSupervisorAssignment.count()) >= 0);
  check("ApprovalDelegation 資料表可查詢", (await prisma.approvalDelegation.count()) >= 0);
  check("ApprovalRecord 資料表可查詢", (await prisma.approvalRecord.count()) >= 0);
  check("StageRiskCheck 資料表可查詢", (await prisma.stageRiskCheck.count()) >= 0);

  console.log("\n=== M1.5-A1 驗證：ApprovalRecord 建立／重複拒絕（BUSINESS_APPROVAL） ===");

  const record1 = await createPendingApprovalRecord({
    issueId: issue1.id,
    approvalType: "BUSINESS_APPROVAL",
    relatedStageKey: "pendingBusinessApproval",
    requestedByUserId: reporter.id,
  });
  fx.approvalRecordIdsNewestFirst.unshift(record1.id);
  check(
    "createPendingApprovalRecord：成功建立第一筆 ACTIVE+PENDING，supervisorAssignmentId（核准責任目標）已寫入",
    record1.decision === "PENDING" && record1.recordStatus === "ACTIVE" && record1.supervisorAssignmentId === assignment1.id,
  );
  check(
    "PENDING 業務核准：approvalAuthorityType／approvalDelegationId／delegatedFromUserId 必須為 null（實際核准途徑尚未發生，即使唯一直屬主管已可解析）",
    record1.approvalAuthorityType === null && record1.approvalDelegationId === null && record1.delegatedFromUserId === null,
  );
  check("PENDING 業務核准：approverTeamId 必須為 null", record1.approverTeamId === null);
  check(
    "createPendingApprovalRecord：reporter 的主管本人＋其有效代理人（delegate）同時合格，兩位以上候選人時 expectedApproverUserId 必須為 null；不得預先寫入任一代表 delegation 或實際 authority type",
    record1.expectedApproverUserId === null && record1.approvalDelegationId === null && record1.approvalAuthorityType === null,
  );

  await expectError(
    "createPendingApprovalRecord：同一 issueId+approvalType+relatedStageKey 第二筆 ACTIVE+PENDING 被服務層拒絕",
    () =>
      createPendingApprovalRecord({
        issueId: issue1.id,
        approvalType: "BUSINESS_APPROVAL",
        relatedStageKey: "pendingBusinessApproval",
        requestedByUserId: reporter.id,
      }),
    (e) => e instanceof DuplicateActivePendingApprovalError,
  );

  await expectError(
    "partial unique index：繞過服務層直接以 Prisma 建立第二筆 ACTIVE+PENDING 時被 DB 拒絕",
    () =>
      prisma.approvalRecord.create({
        data: {
          issueId: issue1.id,
          approvalType: "BUSINESS_APPROVAL",
          relatedStageKey: "pendingBusinessApproval",
          requestedByUserId: reporter.id,
          approvalAuthorityType: "DIRECT_SUPERVISOR",
          supervisorAssignmentId: assignment1.id,
          expectedApproverUserId: supervisor.id,
        },
      }),
    (e) => typeof e === "object" && e !== null && "code" in e && (e as { code?: unknown }).code === "P2002",
  );

  console.log("\n=== M1.5-A1 驗證：自行核准阻擋（DB 版本） ===");

  await expectError(
    "decideApprovalRecord：requestedByUserId 自行核准被拒絕",
    () => decideApprovalRecord({ approvalRecordId: record1.id, actorUserId: reporter.id, decision: "APPROVED" }),
    (e) => e instanceof SelfApprovalError,
  );

  console.log("\n=== M1.5-A1 驗證：資格來源由服務層自行解析，不接受呼叫端偽造 ===");

  await expectError(
    "decideApprovalRecord：完全無關的 stranger 被拒絕（無任何指派／代理紀錄）",
    () => decideApprovalRecord({ approvalRecordId: record1.id, actorUserId: stranger.id, decision: "APPROVED" }),
    (e) => e instanceof ApprovalAuthorityMismatchError,
  );

  const forgedDirectSupervisorInput = {
    approvalRecordId: record1.id,
    actorUserId: stranger.id,
    decision: "APPROVED",
    // 以下欄位為偽造嘗試：型別上 DecideApprovalInput 根本不存在這些欄位，
    // 此處以 as any 模擬「惡意呼叫端額外塞入資格宣稱」，驗證服務層完全忽略。
    approvalAuthorityType: "DIRECT_SUPERVISOR",
    supervisorAssignmentId: assignment1.id,
  } as unknown as DecideApprovalInput;
  await expectError(
    "decideApprovalRecord：呼叫端偽造 DIRECT_SUPERVISOR 資格（夾帶 supervisorAssignmentId）被拒絕，服務層現場重新解析而非採信輸入",
    () => decideApprovalRecord(forgedDirectSupervisorInput),
    (e) => e instanceof ApprovalAuthorityMismatchError,
  );

  await expectError(
    "decideApprovalRecord：Admin 角色本身無法藉由角色取得核准權",
    () => decideApprovalRecord({ approvalRecordId: record1.id, actorUserId: admin.id, decision: "APPROVED" }),
    (e) => e instanceof ApprovalAuthorityMismatchError,
  );
  await expectError(
    "decideApprovalRecord：資安推動小組角色本身無法藉由角色取得核准權",
    () => decideApprovalRecord({ approvalRecordId: record1.id, actorUserId: secTeam.id, decision: "APPROVED" }),
    (e) => e instanceof ApprovalAuthorityMismatchError,
  );

  console.log("\n=== M1.5-A1 驗證：正常決策與 revision 取代鏈 ===");

  const decided1 = await decideApprovalRecord({ approvalRecordId: record1.id, actorUserId: supervisor.id, decision: "REJECTED" });
  check(
    "decideApprovalRecord：直屬主管本人可正確 REJECTED，approverUserId／decidedAt／資格欄位由服務層寫入",
    decided1.decision === "REJECTED" &&
      decided1.approverUserId === supervisor.id &&
      decided1.decidedAt !== null &&
      decided1.approvalAuthorityType === "DIRECT_SUPERVISOR" &&
      decided1.supervisorAssignmentId === assignment1.id,
  );
  await checkAsync("服務層寫入的資格來源可追溯到真實 DB 紀錄（supervisorAssignmentId 對應的 assignment 確實是 supervisor→reporter）", async () => {
    const assignment = await prisma.userSupervisorAssignment.findUnique({ where: { id: decided1.supervisorAssignmentId ?? "" } });
    return assignment !== null && assignment.userId === reporter.id && assignment.supervisorUserId === supervisor.id;
  });

  const forgedRevisionInput = {
    issueId: issue1.id,
    approvalType: "BUSINESS_APPROVAL",
    relatedStageKey: "pendingBusinessApproval",
    requestedByUserId: reporter.id,
    previousApprovalRecordId: record1.id,
    revisionNo: 99, // 偽造嘗試：型別上不存在此欄位，模擬惡意呼叫端夾帶，驗證服務層忽略並自行計算
  } as unknown as Parameters<typeof resubmitApprovalRecord>[0];
  const record2 = await resubmitApprovalRecord(forgedRevisionInput);
  fx.approvalRecordIdsNewestFirst.unshift(record2.id);
  check(
    "resubmitApprovalRecord：revisionNo 由服務層自行計算為 2（忽略呼叫端偽造的 revisionNo=99）",
    record2.revisionNo === 2 && record2.supersedesApprovalRecordId === record1.id,
  );
  await checkAsync("resubmitApprovalRecord：舊 revision 已標記為 SUPERSEDED", async () => {
    const prev = await prisma.approvalRecord.findUnique({ where: { id: record1.id } });
    return prev?.recordStatus === "SUPERSEDED";
  });

  await expectError(
    "resubmitApprovalRecord：同一舊 revision 被第二筆新紀錄重複 supersede 時被服務層拒絕（previous 已非 ACTIVE）",
    () =>
      resubmitApprovalRecord({
        issueId: issue1.id,
        approvalType: "BUSINESS_APPROVAL",
        relatedStageKey: "pendingBusinessApproval",
        requestedByUserId: reporter.id,
        previousApprovalRecordId: record1.id,
      }),
    (e) => e instanceof ApprovalStateError,
  );

  await expectError(
    "supersedesApprovalRecordId unique constraint：繞過服務層直接以 Prisma 對同一舊 revision 建立第二筆 supersede 時被 DB 拒絕",
    () =>
      prisma.approvalRecord.create({
        data: {
          issueId: issue1.id,
          approvalType: "BUSINESS_APPROVAL",
          relatedStageKey: "pendingBusinessApproval_dup",
          requestedByUserId: reporter.id,
          approvalAuthorityType: "DIRECT_SUPERVISOR",
          supervisorAssignmentId: assignment1.id,
          revisionNo: 2,
          supersedesApprovalRecordId: record1.id,
        },
      }),
    (e) => typeof e === "object" && e !== null && "code" in e && (e as { code?: unknown }).code === "P2002",
  );

  const decided2 = await decideApprovalRecord({ approvalRecordId: record2.id, actorUserId: supervisor.id, decision: "APPROVED" });
  check("decideApprovalRecord：第二個 revision 可正確 APPROVED", decided2.decision === "APPROVED");
  check(
    "checkApprovalRecordConsistency：實際寫入 DB 的第二個 revision 通過決策欄位一致性檢查",
    checkApprovalRecordConsistency({
      approvalType: decided2.approvalType,
      decision: decided2.decision,
      recordStatus: decided2.recordStatus,
      decidedAt: decided2.decidedAt,
      approverUserId: decided2.approverUserId,
      approverTeamId: decided2.approverTeamId,
      approvalAuthorityType: decided2.approvalAuthorityType,
      supervisorAssignmentId: decided2.supervisorAssignmentId,
      approvalDelegationId: decided2.approvalDelegationId,
      delegatedFromUserId: decided2.delegatedFromUserId,
      decisionReasonCode: decided2.decisionReasonCode,
      decisionComment: decided2.decisionComment,
      revisionNo: decided2.revisionNo,
      supersedesApprovalRecordId: decided2.supersedesApprovalRecordId,
      invalidatedAt: decided2.invalidatedAt,
      invalidationReason: decided2.invalidationReason,
    }).ok,
  );

  console.log("\n=== M1.5-A1 驗證：supervisor assignment 重疊 primary／循環（服務層以真實 DB 資料判斷） ===");

  const assignmentMultiA = await prisma.userSupervisorAssignment.create({
    data: { userId: reporterMulti.id, supervisorUserId: supervisor.id, validFrom: new Date(Date.now() - DAY), isPrimary: true, createdByUserId: supervisor.id },
  });
  const assignmentMultiB = await prisma.userSupervisorAssignment.create({
    data: { userId: reporterMulti.id, supervisorUserId: supervisor2.id, validFrom: new Date(Date.now() - DAY), isPrimary: true, createdByUserId: supervisor2.id },
  });
  fx.assignmentIds.push(assignmentMultiA.id, assignmentMultiB.id);
  await expectError(
    "createPendingApprovalRecord：reporter 存在重疊的雙重 primary 主管指派時，服務層拒絕建立（無法唯一解析資格來源）",
    () =>
      createPendingApprovalRecord({
        issueId: issue1.id,
        approvalType: "BUSINESS_APPROVAL",
        relatedStageKey: "pendingBusinessApproval_multiPrimary",
        requestedByUserId: reporterMulti.id,
      }),
    (e) => e instanceof ApprovalValidationError,
  );

  const assignmentCycleA = await prisma.userSupervisorAssignment.create({
    data: { userId: reporterCycleA.id, supervisorUserId: reporterCycleB.id, validFrom: new Date(Date.now() - DAY), isPrimary: true, createdByUserId: reporterCycleB.id },
  });
  const assignmentCycleB = await prisma.userSupervisorAssignment.create({
    data: { userId: reporterCycleB.id, supervisorUserId: reporterCycleA.id, validFrom: new Date(Date.now() - DAY), isPrimary: true, createdByUserId: reporterCycleA.id },
  });
  fx.assignmentIds.push(assignmentCycleA.id, assignmentCycleB.id);
  await checkAsync("wouldCreateSupervisorCycle：以真實 DB 資料偵測到 reporterCycleA↔reporterCycleB 互為主管形成循環", async () => {
    const rows = await prisma.userSupervisorAssignment.findMany({
      where: { userId: { in: [reporterCycleA.id, reporterCycleB.id] } },
    });
    const likeRows: SupervisorAssignmentLike[] = rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      supervisorUserId: r.supervisorUserId,
      validFrom: r.validFrom,
      validUntil: r.validUntil,
      isPrimary: r.isPrimary,
      isActive: r.isActive,
    }));
    return wouldCreateSupervisorCycle(likeRows, reporterCycleA.id, reporterCycleB.id);
  });

  console.log("\n=== M1.5-A1 驗證：null risk check 不得送核 ===");

  const rdTemplate2 = getRiskCheckTemplate(RD_LEAD_APPROVAL_STAGE_KEY) ?? [];
  const riskCheckIds: string[] = [];
  for (const item of rdTemplate2) {
    const rc = await prisma.stageRiskCheck.create({
      data: { issueId: issueRd.id, stageKey: RD_LEAD_APPROVAL_STAGE_KEY, assessmentRound: 1, checkKey: item.checkKey, answer: null },
    });
    riskCheckIds.push(rc.id);
  }

  await expectError(
    "createPendingApprovalRecord：RD_LEAD_APPROVAL 風險檢核尚有 null 答案時拒絕送核",
    () =>
      createPendingApprovalRecord({
        issueId: issueRd.id,
        approvalType: "RD_LEAD_APPROVAL",
        relatedStageKey: RD_LEAD_APPROVAL_STAGE_KEY,
        requestedByUserId: rdMember.id,
      }),
    (e) => e instanceof RiskCheckIncompleteError,
  );

  for (const item of rdTemplate2) {
    const answer = item.checkKey === "hasUnknownDependency" ? "UNKNOWN" : "YES";
    await prisma.stageRiskCheck.updateMany({
      where: { issueId: issueRd.id, stageKey: RD_LEAD_APPROVAL_STAGE_KEY, assessmentRound: 1, checkKey: item.checkKey },
      data: { answer, answeredByUserId: rdMember.id, answeredAt: new Date() },
    });
  }

  console.log("\n=== M1.5-A1 驗證：TEAM_LEAD 資格（含偽造與跨團隊拒絕）／UNKNOWN 決策阻擋 ===");

  const record3 = await createPendingApprovalRecord({
    issueId: issueRd.id,
    approvalType: "RD_LEAD_APPROVAL",
    relatedStageKey: RD_LEAD_APPROVAL_STAGE_KEY,
    requestedByUserId: rdMember.id,
  });
  fx.approvalRecordIdsNewestFirst.unshift(record3.id);
  check(
    "createPendingApprovalRecord：RD_LEAD_APPROVAL 全部已填答（含 UNKNOWN）後可成功建立，approverTeamId（核准責任目標）取自 Issue.assignedTeamId",
    record3.decision === "PENDING" && record3.approverTeamId === teamRd.id,
  );
  check(
    "PENDING 技術核准：approverTeamId 可存在，approvalAuthorityType 必須為 null（實際核准途徑尚未發生，即使已有 LEAD 可解析）",
    record3.approverTeamId !== null && record3.approvalAuthorityType === null,
  );
  check("PENDING 技術核准：supervisorAssignmentId 必須為 null", record3.supervisorAssignmentId === null);
  check(
    "LEAD 加代理人形成多候選時 expectedApproverUserId 為 null（rdLead 本人＋其有效代理人 rdDelegate 同時合格）；不得預先寫入任一代表 delegation 或實際 authority type",
    record3.expectedApproverUserId === null && record3.approvalDelegationId === null && record3.approvalAuthorityType === null,
  );
  await prisma.stageRiskCheck.updateMany({ where: { id: { in: riskCheckIds } }, data: { approvalRecordId: record3.id } });

  await expectError(
    "decideApprovalRecord：呼叫端偽造 TEAM_LEAD 資格（一般 MEMBER、非送核人，嘗試決策）被拒絕",
    () => decideApprovalRecord({ approvalRecordId: record3.id, actorUserId: rdMember2.id, decision: "APPROVED" }),
    (e) => e instanceof ApprovalAuthorityMismatchError,
  );

  await expectError(
    "decideApprovalRecord：不屬於指定團隊的 LEAD（otherLead 屬於 teamOther，非 issueRd 指派的 teamRd）被拒絕",
    () => decideApprovalRecord({ approvalRecordId: record3.id, actorUserId: otherLead.id, decision: "APPROVED" }),
    (e) => e instanceof ApprovalAuthorityMismatchError,
  );

  await expectError(
    "decideApprovalRecord：UNKNOWN 未 resolve 時，即使是合格的 team LEAD 也不可 APPROVED",
    () => decideApprovalRecord({ approvalRecordId: record3.id, actorUserId: rdLead.id, decision: "APPROVED" }),
    (e) => e instanceof UnresolvedUnknownRiskError,
  );

  await prisma.stageRiskCheck.updateMany({
    where: { issueId: issueRd.id, stageKey: RD_LEAD_APPROVAL_STAGE_KEY, checkKey: "hasUnknownDependency" },
    data: { resolvedAt: new Date(), resolvedByUserId: rdLead.id, resolutionComment: "verified acceptable" },
  });

  const decided3 = await decideApprovalRecord({ approvalRecordId: record3.id, actorUserId: rdLead.id, decision: "APPROVED" });
  check(
    "decideApprovalRecord：UNKNOWN 解除後，team LEAD 可重新判斷並成功 APPROVED",
    decided3.decision === "APPROVED" && decided3.approverUserId === rdLead.id && decided3.approvalAuthorityType === "TEAM_LEAD",
  );

  console.log("\n=== M1.5-A1 驗證：TEAM_LEAD 類型的有效代理與過期代理 ===");

  for (const item of rdTemplate2) {
    await prisma.stageRiskCheck.create({
      data: { issueId: issueRdDelegate.id, stageKey: RD_LEAD_APPROVAL_STAGE_KEY, assessmentRound: 1, checkKey: item.checkKey, answer: "YES" },
    });
  }
  const record4 = await createPendingApprovalRecord({
    issueId: issueRdDelegate.id,
    approvalType: "RD_LEAD_APPROVAL",
    relatedStageKey: RD_LEAD_APPROVAL_STAGE_KEY,
    requestedByUserId: rdMember.id,
  });
  fx.approvalRecordIdsNewestFirst.unshift(record4.id);
  check(
    "record4 同樣為多候選（rdLead＋rdDelegate），expectedApproverUserId 為 null",
    record4.expectedApproverUserId === null,
  );
  const decided4 = await decideApprovalRecord({ approvalRecordId: record4.id, actorUserId: rdDelegate.id, decision: "APPROVED" });
  check(
    "expectedApproverUserId 為 null 不影響合法候選人完成核准（record4 expectedApproverUserId=null，仍可由代理人 rdDelegate 成功 APPROVED）",
    record4.expectedApproverUserId === null && decided4.decision === "APPROVED",
  );
  check(
    "decideApprovalRecord：有效代理人（rdDelegate）可代理 rdLead 完成 APPROVED，資格來源正確記錄為 DELEGATE",
    decided4.decision === "APPROVED" &&
      decided4.approverUserId === rdDelegate.id &&
      decided4.approvalAuthorityType === "DELEGATE" &&
      decided4.approvalDelegationId === rdDelegation.id &&
      decided4.delegatedFromUserId === rdLead.id,
  );
  check(
    "技術代理核准後：approverTeamId（核准責任目標）仍保留為 teamRd，未因代理途徑被清空或改動",
    decided4.approverTeamId === teamRd.id,
  );

  for (const item of rdTemplate2) {
    await prisma.stageRiskCheck.create({
      data: { issueId: issueRdExpiredDelegate.id, stageKey: RD_LEAD_APPROVAL_STAGE_KEY, assessmentRound: 1, checkKey: item.checkKey, answer: "YES" },
    });
  }
  const record5 = await createPendingApprovalRecord({
    issueId: issueRdExpiredDelegate.id,
    approvalType: "RD_LEAD_APPROVAL",
    relatedStageKey: RD_LEAD_APPROVAL_STAGE_KEY,
    requestedByUserId: rdMember.id,
  });
  fx.approvalRecordIdsNewestFirst.unshift(record5.id);
  await expectError(
    "decideApprovalRecord：已過期的代理人（rdDelegateExpired，validUntil 已過）被拒絕",
    () => decideApprovalRecord({ approvalRecordId: record5.id, actorUserId: rdDelegateExpired.id, decision: "APPROVED" }),
    (e) => e instanceof ApprovalAuthorityMismatchError,
  );
  await decideApprovalRecord({ approvalRecordId: record5.id, actorUserId: rdLead.id, decision: "APPROVED" });

  console.log("\n=== M1.5-A1 驗證：Admin／資安推動小組於 BUSINESS_APPROVAL 情境下同樣無法取得核准權 ===");

  const record6 = await createPendingApprovalRecord({
    issueId: issueAdmin.id,
    approvalType: "BUSINESS_APPROVAL",
    relatedStageKey: "pendingBusinessApproval",
    requestedByUserId: reporter.id,
  });
  fx.approvalRecordIdsNewestFirst.unshift(record6.id);
  await expectError(
    "decideApprovalRecord：Admin 對另一筆 BUSINESS_APPROVAL 紀錄仍無法核准",
    () => decideApprovalRecord({ approvalRecordId: record6.id, actorUserId: admin.id, decision: "APPROVED" }),
    (e) => e instanceof ApprovalAuthorityMismatchError,
  );
  await decideApprovalRecord({ approvalRecordId: record6.id, actorUserId: delegate.id, decision: "APPROVED" });
  await checkAsync("decideApprovalRecord：有效代理人（delegate）可代理 supervisor 完成 BUSINESS_APPROVAL", async () => {
    const r = await prisma.approvalRecord.findUnique({ where: { id: record6.id } });
    return r?.decision === "APPROVED" && r.approvalAuthorityType === "DELEGATE" && r.approvalDelegationId === delegation1.id;
  });
  await checkAsync(
    "業務代理核准後：supervisorAssignmentId（核准責任目標）仍保留為原始業務主管責任來源，delegatedFromUserId 正確",
    async () => {
      const r = await prisma.approvalRecord.findUnique({ where: { id: record6.id } });
      return r?.supervisorAssignmentId === assignment1.id && r.delegatedFromUserId === supervisor.id;
    },
  );

  console.log("\n=== M1.5-A1 驗證：expectedApproverUserId 多候選人語意（DB 版本：唯一候選人 vs 多位候選人） ===");

  const reporterSingle = await createUser("reporterSingle", "PM");
  const supervisorSingle = await createUser("supervisorSingle", "DMS主管");
  fx.userIds.push(reporterSingle.id, supervisorSingle.id);
  const assignmentSingle = await prisma.userSupervisorAssignment.create({
    data: { userId: reporterSingle.id, supervisorUserId: supervisorSingle.id, validFrom: new Date(Date.now() - DAY), isPrimary: true, createdByUserId: supervisorSingle.id },
  });
  fx.assignmentIds.push(assignmentSingle.id);
  const issueSingle = await prisma.issue.create({
    data: { issueKey: `${RUN_TAG}-HOTFIX-6`, issueType: "Hotfix", title: "verify issue single supervisor", workflowStatus: "pendingBusinessApproval" },
  });
  fx.issueIds.push(issueSingle.id);
  const recordSingle = await createPendingApprovalRecord({
    issueId: issueSingle.id,
    approvalType: "BUSINESS_APPROVAL",
    relatedStageKey: "pendingBusinessApproval",
    requestedByUserId: reporterSingle.id,
  });
  fx.approvalRecordIdsNewestFirst.unshift(recordSingle.id);
  check(
    "唯一合格核准人時 expectedApproverUserId 正確填入（BUSINESS_APPROVAL，reporterSingle 的主管無任何代理人）",
    recordSingle.expectedApproverUserId === supervisorSingle.id,
  );
  check(
    "唯一合格核准人存在時，approvalAuthorityType 仍必須為 null（expectedApproverUserId 僅為顯示值，不代表核准已發生）",
    recordSingle.approvalAuthorityType === null,
  );

  const rdLeadSolo = await createUser("rdLeadSolo", "RD");
  fx.userIds.push(rdLeadSolo.id);
  const teamRdSolo = await prisma.team.create({ data: { name: `${RUN_TAG}-team-rd-solo` } });
  fx.teamIds.push(teamRdSolo.id);
  await prisma.teamMember.create({ data: { teamId: teamRdSolo.id, userId: rdLeadSolo.id, membershipRole: "LEAD" } });
  const issueRdSolo = await prisma.issue.create({
    data: { issueKey: `${RUN_TAG}-HOTFIX-7`, issueType: "Hotfix", title: "verify issue solo lead", workflowStatus: "rdInProgress", assignedTeamId: teamRdSolo.id },
  });
  fx.issueIds.push(issueRdSolo.id);
  for (const item of rdTemplate2) {
    await prisma.stageRiskCheck.create({
      data: { issueId: issueRdSolo.id, stageKey: RD_LEAD_APPROVAL_STAGE_KEY, assessmentRound: 1, checkKey: item.checkKey, answer: "YES" },
    });
  }
  const recordSolo = await createPendingApprovalRecord({
    issueId: issueRdSolo.id,
    approvalType: "RD_LEAD_APPROVAL",
    relatedStageKey: RD_LEAD_APPROVAL_STAGE_KEY,
    requestedByUserId: rdMember.id,
  });
  fx.approvalRecordIdsNewestFirst.unshift(recordSolo.id);
  check(
    "唯一合格核准人時 expectedApproverUserId 正確填入（RD_LEAD_APPROVAL，團隊只有單一 LEAD 且無代理人）",
    recordSolo.expectedApproverUserId === rdLeadSolo.id,
  );
  check("唯一合格核准人存在時，approvalAuthorityType 仍必須為 null", recordSolo.approvalAuthorityType === null);

  const rdLeadDual1 = await createUser("rdLeadDual1", "RD");
  const rdLeadDual2 = await createUser("rdLeadDual2", "RD");
  fx.userIds.push(rdLeadDual1.id, rdLeadDual2.id);
  const teamRdDual = await prisma.team.create({ data: { name: `${RUN_TAG}-team-rd-dual` } });
  fx.teamIds.push(teamRdDual.id);
  await prisma.teamMember.create({ data: { teamId: teamRdDual.id, userId: rdLeadDual1.id, membershipRole: "LEAD" } });
  await prisma.teamMember.create({ data: { teamId: teamRdDual.id, userId: rdLeadDual2.id, membershipRole: "LEAD" } });
  const issueRdDual = await prisma.issue.create({
    data: { issueKey: `${RUN_TAG}-HOTFIX-8`, issueType: "Hotfix", title: "verify issue dual lead", workflowStatus: "rdInProgress", assignedTeamId: teamRdDual.id },
  });
  fx.issueIds.push(issueRdDual.id);
  for (const item of rdTemplate2) {
    await prisma.stageRiskCheck.create({
      data: { issueId: issueRdDual.id, stageKey: RD_LEAD_APPROVAL_STAGE_KEY, assessmentRound: 1, checkKey: item.checkKey, answer: "YES" },
    });
  }
  const recordDual = await createPendingApprovalRecord({
    issueId: issueRdDual.id,
    approvalType: "RD_LEAD_APPROVAL",
    relatedStageKey: RD_LEAD_APPROVAL_STAGE_KEY,
    requestedByUserId: rdMember.id,
  });
  fx.approvalRecordIdsNewestFirst.unshift(recordDual.id);
  check(
    "多候選人時：expectedApproverUserId 為 null（團隊有兩位有效 LEAD、無代理人），不得預先寫入任一實際 authority type",
    recordDual.expectedApproverUserId === null && recordDual.approvalAuthorityType === null && recordDual.approvalDelegationId === null,
  );
  const decidedDual = await decideApprovalRecord({ approvalRecordId: recordDual.id, actorUserId: rdLeadDual2.id, decision: "APPROVED" });
  check(
    "expectedApproverUserId 為 null 不影響任何一位合法候選人完成核准（兩位 LEAD 中的 rdLeadDual2 仍可成功 APPROVED）",
    decidedDual.decision === "APPROVED" && decidedDual.approverUserId === rdLeadDual2.id,
  );

  console.log("\n=== M1.5-A3 驗證：呼叫端偽造核准責任目標／實際核准途徑欄位仍被忽略 ===");

  const reporterForge = await createUser("reporterForge", "PM");
  const supervisorForge = await createUser("supervisorForge", "DMS主管");
  fx.userIds.push(reporterForge.id, supervisorForge.id);
  const assignmentForge = await prisma.userSupervisorAssignment.create({
    data: { userId: reporterForge.id, supervisorUserId: supervisorForge.id, validFrom: new Date(Date.now() - DAY), isPrimary: true, createdByUserId: supervisorForge.id },
  });
  fx.assignmentIds.push(assignmentForge.id);
  const issueForge = await prisma.issue.create({
    data: { issueKey: `${RUN_TAG}-HOTFIX-9`, issueType: "Hotfix", title: "verify issue forged create input", workflowStatus: "pendingBusinessApproval" },
  });
  fx.issueIds.push(issueForge.id);
  const forgedCreateInput = {
    issueId: issueForge.id,
    approvalType: "BUSINESS_APPROVAL",
    relatedStageKey: "pendingBusinessApproval",
    requestedByUserId: reporterForge.id,
    // 型別上 CreatePendingApprovalInput 根本不存在這些欄位，以 as any 模擬惡意呼叫端夾帶，
    // 驗證服務層完全忽略並自行以 Issue.assignedTeamId／現場查詢重新解析。
    approvalAuthorityType: "TEAM_LEAD",
    supervisorAssignmentId: "forged-assignment-id",
    approverTeamId: "forged-team-id",
    approvalDelegationId: "forged-delegation-id",
    delegatedFromUserId: "forged-user-id",
    expectedApproverUserId: "forged-expected-id",
  } as unknown as CreatePendingApprovalInput;
  const recordForged = await createPendingApprovalRecord(forgedCreateInput);
  fx.approvalRecordIdsNewestFirst.unshift(recordForged.id);
  check(
    "createPendingApprovalRecord：呼叫端偽造 approvalAuthorityType／approverTeamId／approvalDelegationId／delegatedFromUserId／expectedApproverUserId 皆被忽略，改由服務層現場正確解析",
    recordForged.approvalAuthorityType === null &&
      recordForged.approverTeamId === null &&
      recordForged.approvalDelegationId === null &&
      recordForged.delegatedFromUserId === null &&
      recordForged.supervisorAssignmentId === assignmentForge.id &&
      recordForged.expectedApproverUserId === supervisorForge.id,
  );

  console.log("\n=== M1.5-A1 驗證：半開區間邊界（真實 DB 資料 + 指定 now） ===");

  const boundaryUser = await createUser("boundaryUser", "PM");
  const boundarySupervisor = await createUser("boundarySupervisor", "DMS主管");
  fx.userIds.push(boundaryUser.id, boundarySupervisor.id);
  const boundaryT = new Date("2026-08-01T00:00:00.000Z");
  const boundaryAssignment = await prisma.userSupervisorAssignment.create({
    data: {
      userId: boundaryUser.id,
      supervisorUserId: boundarySupervisor.id,
      validFrom: new Date(boundaryT.getTime() - DAY),
      validUntil: boundaryT,
      isPrimary: true,
      createdByUserId: boundarySupervisor.id,
    },
  });
  fx.assignmentIds.push(boundaryAssignment.id);
  const fetchedBoundary = await prisma.userSupervisorAssignment.findUnique({ where: { id: boundaryAssignment.id } });
  check(
    "半開區間：真實 DB 資料在 now=validUntil(T) 時已視為失效",
    fetchedBoundary !== null &&
      getEffectiveSupervisor(
        [
          {
            id: fetchedBoundary.id,
            userId: fetchedBoundary.userId,
            supervisorUserId: fetchedBoundary.supervisorUserId,
            validFrom: fetchedBoundary.validFrom,
            validUntil: fetchedBoundary.validUntil,
            isPrimary: fetchedBoundary.isPrimary,
            isActive: fetchedBoundary.isActive,
          },
        ],
        boundaryUser.id,
        boundaryT,
      ).kind === "none",
  );
  check(
    "半開區間：真實 DB 資料在 now=T-1ms 時仍視為有效",
    fetchedBoundary !== null &&
      getEffectiveSupervisor(
        [
          {
            id: fetchedBoundary.id,
            userId: fetchedBoundary.userId,
            supervisorUserId: fetchedBoundary.supervisorUserId,
            validFrom: fetchedBoundary.validFrom,
            validUntil: fetchedBoundary.validUntil,
            isPrimary: fetchedBoundary.isPrimary,
            isActive: fetchedBoundary.isActive,
          },
        ],
        boundaryUser.id,
        new Date(boundaryT.getTime() - 1),
      ).kind === "resolved",
  );

  console.log("\n=== M1.5-A1 驗證：PRAGMA 結構檢查 ===");

  const integrityResult = await prisma.$queryRawUnsafe<{ integrity_check: string }[]>("PRAGMA integrity_check;");
  check("PRAGMA integrity_check = ok", integrityResult.length === 1 && integrityResult[0].integrity_check === "ok");

  const fkCheckResult = await prisma.$queryRawUnsafe<unknown[]>("PRAGMA foreign_key_check;");
  check("PRAGMA foreign_key_check 無結果（無孤兒外鍵）", fkCheckResult.length === 0);

  // 注意：sqlite3 driver 透過 $queryRawUnsafe 回傳的 PRAGMA 整數欄位（unique／partial）型別為
  // BigInt，不得直接以 === 1（number）比較，否則恆為 false，須先以 Number() 轉型。
  const approvalRecordIndexes = await prisma.$queryRawUnsafe<{ name: string; unique: bigint; partial: bigint }[]>(
    "PRAGMA index_list('ApprovalRecord');",
  );
  const oneActivePendingIndex = approvalRecordIndexes.find((i) => i.name === "ApprovalRecord_one_active_pending");
  check(
    "ApprovalRecord_one_active_pending 存在且為 unique partial index",
    oneActivePendingIndex !== undefined && Number(oneActivePendingIndex.unique) === 1 && Number(oneActivePendingIndex.partial) === 1,
  );
  const supersedesIndex = approvalRecordIndexes.find((i) => i.name === "ApprovalRecord_supersedesApprovalRecordId_key");
  check("supersedesApprovalRecordId unique constraint 存在", supersedesIndex !== undefined && Number(supersedesIndex.unique) === 1);

  const approvalRecordFks = await prisma.$queryRawUnsafe<{ table: string; from: string; on_delete: string; on_update: string }[]>(
    "PRAGMA foreign_key_list('ApprovalRecord');",
  );
  const selfFk = approvalRecordFks.find((f) => f.from === "supersedesApprovalRecordId");
  check(
    "ApprovalRecord.supersedesApprovalRecordId FK 為 NO ACTION／NO ACTION（自我關聯例外）",
    selfFk !== undefined && selfFk.on_delete === "NO ACTION" && selfFk.on_update === "NO ACTION",
  );
  const otherFksRestrict = approvalRecordFks.filter((f) => f.from !== "supersedesApprovalRecordId").every((f) => f.on_delete === "RESTRICT" && f.on_update === "RESTRICT");
  check("ApprovalRecord 其餘 FK 皆為 RESTRICT／RESTRICT", otherFksRestrict);

  const stageRiskCheckIndexes = await prisma.$queryRawUnsafe<{ name: string; unique: bigint }[]>("PRAGMA index_list('StageRiskCheck');");
  const stageRiskCheckUnique = stageRiskCheckIndexes.find((i) => i.name === "StageRiskCheck_issueId_stageKey_assessmentRound_checkKey_key");
  check("StageRiskCheck 複合 unique constraint 存在", stageRiskCheckUnique !== undefined && Number(stageRiskCheckUnique.unique) === 1);
}

async function cleanupFixtures(fx: Fixtures) {
  try {
    await prisma.userRoleHistory.deleteMany({ where: { userId: { in: fx.userIds } } });
  } catch (e) {
    console.warn("cleanup UserRoleHistory 失敗：", e);
  }
  try {
    await prisma.userRole.deleteMany({ where: { userId: { in: fx.userIds } } });
  } catch (e) {
    console.warn("cleanup UserRole 失敗：", e);
  }
  try {
    await prisma.stageRiskCheck.deleteMany({ where: { issueId: { in: fx.issueIds } } });
  } catch (e) {
    console.warn("cleanup StageRiskCheck 失敗：", e);
  }
  for (const id of fx.approvalRecordIdsNewestFirst) {
    try {
      await prisma.approvalRecord.delete({ where: { id } });
    } catch (e) {
      console.warn(`cleanup ApprovalRecord ${id} 失敗：`, e);
    }
  }
  try {
    await prisma.approvalRecord.deleteMany({ where: { issueId: { in: fx.issueIds } } });
  } catch (e) {
    console.warn("cleanup 殘留 ApprovalRecord 失敗：", e);
  }
  try {
    await prisma.approvalDelegation.deleteMany({ where: { id: { in: fx.delegationIds } } });
  } catch (e) {
    console.warn("cleanup ApprovalDelegation 失敗：", e);
  }
  try {
    await prisma.teamMember.deleteMany({ where: { teamId: { in: fx.teamIds } } });
  } catch (e) {
    console.warn("cleanup TeamMember 失敗：", e);
  }
  try {
    await prisma.userSupervisorAssignment.deleteMany({ where: { id: { in: fx.assignmentIds } } });
  } catch (e) {
    console.warn("cleanup UserSupervisorAssignment 失敗：", e);
  }
  try {
    await prisma.issue.deleteMany({ where: { id: { in: fx.issueIds } } });
  } catch (e) {
    console.warn("cleanup Issue 失敗：", e);
  }
  try {
    await prisma.team.deleteMany({ where: { id: { in: fx.teamIds } } });
  } catch (e) {
    console.warn("cleanup Team 失敗：", e);
  }
  try {
    await prisma.user.deleteMany({ where: { id: { in: fx.userIds } } });
  } catch (e) {
    console.warn("cleanup User 失敗：", e);
  }
}

async function main() {
  runPureLogicTests();

  console.log("\n=== 資料庫相依檢查（需 Migration 已套用；未套用時 SKIPPED，不嘗試自動套用） ===");

  let migrationApplied = false;
  try {
    await prisma.approvalRecord.count();
    migrationApplied = true;
  } catch {
    migrationApplied = false;
  }

  if (!migrationApplied) {
    skip(
      "ApprovalRecord / StageRiskCheck / UserSupervisorAssignment / ApprovalDelegation 資料表查詢與服務層信任邊界實測",
      "資料表尚未建立，等待 Migration 套用至測試資料庫後才能驗證，本輪不對任何資料庫套用 Migration",
    );
  } else {
    const fx: Fixtures = {
      userIds: [],
      teamIds: [],
      issueIds: [],
      assignmentIds: [],
      delegationIds: [],
      approvalRecordIdsNewestFirst: [],
    };
    try {
      await runDbDependentTests(fx);
    } finally {
      await cleanupFixtures(fx);
    }
  }

  console.log(`\n=== 結果：PASS=${passCount} FAIL=${failCount} SKIP=${skipCount} ===`);

  await prisma.$disconnect();

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error("m1_5-verify 執行時發生未預期錯誤：", err);
  await prisma.$disconnect();
  process.exit(1);
});
