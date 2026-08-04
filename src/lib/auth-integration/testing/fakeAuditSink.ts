// C2-B1 Fake Audit Sink — 僅供測試使用，收集記錄下來的事件供斷言。

import type { AuthAuditSink } from "../ports";
import type { AuthAuditEvent } from "../types";

export interface FakeAuditSink extends AuthAuditSink {
  readonly events: readonly AuthAuditEvent[];
}

export function createFakeAuditSink(): FakeAuditSink {
  const events: AuthAuditEvent[] = [];
  return {
    events,
    async record(event: AuthAuditEvent): Promise<void> {
      events.push(event);
    },
  };
}
