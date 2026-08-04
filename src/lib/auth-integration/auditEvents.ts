// C2-B1 Audit Event Descriptor — 建構函式。
//
// 安全邊界：沿用 C2-A 的 redactMessage（不重建新的 redaction 規則）。subject
// 一律以 sha256 雜湊後的短參考值儲存，不保留明文——即使呼叫端傳入的 subject
// 本身不算高度機密，仍一律雜湊，避免未來稽核紀錄外洩時可反查外部帳號代碼。

import { createHash } from "node:crypto";
import { redactMessage } from "../auth-providers";
import type { AuthAuditDecisionType, AuthAuditEvent } from "./types";

export function hashSubjectReference(providerKey: string, subject: string): string {
  return createHash("sha256").update(`${providerKey}:${subject}`).digest("hex").slice(0, 16);
}

export interface BuildAuditEventParams {
  readonly providerKey: string;
  readonly subject: string;
  readonly decisionType: AuthAuditDecisionType;
  readonly result: string;
  readonly reasonCode: string;
  readonly correlationId: string;
  readonly detail: string;
}

export function buildAuditEvent(params: BuildAuditEventParams): AuthAuditEvent {
  return {
    providerKey: params.providerKey,
    subjectReference: hashSubjectReference(params.providerKey, params.subject),
    decisionType: params.decisionType,
    result: params.result,
    reasonCode: params.reasonCode,
    timestamp: new Date(),
    correlationId: params.correlationId,
    detail: redactMessage(params.detail),
  };
}
