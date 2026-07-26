// C2-B1 Identity Linking — 純決策函式。
//
// 安全邊界：本檔案完全不查詢任何資料庫——所有候選人都由呼叫端（未來的 C2-B2
// adapter）透過 ports.ts 事先查出並傳入。相同輸入永遠得到相同輸出。不寫入
// User／UserRole／TeamMembership，只回傳 LINK_EXISTING／CREATE_NEW／
// REQUIRE_REVIEW／REJECT 四種決策之一，附帶 reason code 與可稽核解釋。
//
// 規則摘要（見 types.ts 的詳細型別註解）：
//   1. 既有 (providerKey, subject) link 優先——呼叫端必須自行以複合鍵查詢，
//      本函式不做跨 Provider 的 subject 比對。
//   2. 其次比對 loginIdentifier（一律允許，不受 policy 限制）。
//   3. Email 比對是否啟用完全由 policy.allowEmailMatching 決定，預設關閉；
//      即使呼叫端傳入了 emailCandidates，policy 關閉時一律忽略。
//   4. 任一比對出現多個候選人 → REQUIRE_REVIEW，拒絕自動連結。
//   5. displayName 從未作為比對欄位——程式碼中不存在任何 displayName 比較。
//   6. 比對到的候選人若為 Admin，一律轉為 REQUIRE_REVIEW，不自動連結到 Admin。

import type { IdentityLinkDecision, IdentityLinkInput, InternalUserProjection } from "./types";

function decisionFor(
  decision: IdentityLinkDecision["decision"],
  reasonCode: IdentityLinkDecision["reasonCode"],
  explanation: string,
  matchedUserId: string | null = null,
  candidateUserIds: readonly string[] = [],
): IdentityLinkDecision {
  return { decision, reasonCode, explanation, matchedUserId, candidateUserIds };
}

function resolveSingleCandidate(candidate: InternalUserProjection, onMatchReasonCode: IdentityLinkDecision["reasonCode"], onMatchExplanation: string): IdentityLinkDecision {
  if (candidate.isAdmin) {
    return decisionFor(
      "REQUIRE_REVIEW",
      "MATCH_TARGETS_ADMIN_ACCOUNT",
      `找到唯一候選帳號（${candidate.userId}），但該帳號為 Admin，不得自動連結，需人工審核`,
      null,
      [candidate.userId],
    );
  }
  return decisionFor("LINK_EXISTING", onMatchReasonCode, onMatchExplanation, candidate.userId);
}

export function decideIdentityLink(input: IdentityLinkInput): IdentityLinkDecision {
  const { identity, existingLink, loginIdentifierCandidates, emailCandidates, policy } = input;

  // 規則 1／6：既有 provider+subject link 優先，且只信任呼叫端已用複合鍵查出的結果。
  if (existingLink !== null) {
    if (existingLink.status === "REVOKED") {
      return decisionFor("REJECT", "EXISTING_LINK_REVOKED", `既有 (${existingLink.providerKey}, subject) 連結已被撤銷，拒絕登入，不得重新自動連結`);
    }
    return decisionFor("LINK_EXISTING", "EXISTING_LINK_FOUND", `既有 (${existingLink.providerKey}, subject) 連結存在，直接沿用`, existingLink.userId);
  }

  // 規則 2：loginIdentifier 比對一律允許（不受 policy 限制）。
  if (loginIdentifierCandidates.length === 1) {
    return resolveSingleCandidate(loginIdentifierCandidates[0], "UNIQUE_LOGIN_IDENTIFIER_MATCH", `loginIdentifier「${identity.loginIdentifier}」唯一對應到既有帳號`);
  }
  if (loginIdentifierCandidates.length > 1) {
    return decisionFor(
      "REQUIRE_REVIEW",
      "MULTIPLE_LOGIN_IDENTIFIER_CANDIDATES",
      `loginIdentifier「${identity.loginIdentifier}」對應到多個候選帳號，拒絕自動連結`,
      null,
      loginIdentifierCandidates.map((c) => c.userId),
    );
  }

  // 規則 3：Email 比對必須由 policy 明確開啟，預設關閉——關閉時完全不採用 emailCandidates。
  if (!policy.allowEmailMatching) {
    return decisionFor("CREATE_NEW", "EMAIL_MATCHING_DISABLED_BY_POLICY", "Email 自動連結依政策預設關閉，即使可能存在同 email 帳號也不採用，改建立新身分");
  }

  if (emailCandidates.length === 1) {
    return resolveSingleCandidate(emailCandidates[0], "EMAIL_MATCH_ALLOWED_BY_POLICY", `email「${identity.email}」依政策允許比對，唯一對應到既有帳號`);
  }
  if (emailCandidates.length > 1) {
    return decisionFor(
      "REQUIRE_REVIEW",
      "MULTIPLE_EMAIL_CANDIDATES",
      `email「${identity.email}」對應到多個候選帳號，拒絕自動連結`,
      null,
      emailCandidates.map((c) => c.userId),
    );
  }

  return decisionFor("CREATE_NEW", "NO_CANDIDATE_FOUND", "未找到既有連結或候選帳號，建立新身分");
}
