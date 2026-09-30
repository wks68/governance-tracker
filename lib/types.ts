import type { AiSuggestion, AuditLog, Comment, Evidence, Issue, IssueFieldValue } from "@prisma/client";

export type IssueWithRelations = Issue & {
  fieldValues: IssueFieldValue[];
  evidence: Evidence[];
  comments: Comment[];
  auditLogs?: AuditLog[];
  aiSuggestions?: AiSuggestion[];
};

export type FieldValueMap = Record<string, string>;

export type GateResult = {
  passed: boolean;
  missingFields: string[];
  missingEvidence: string[];
  blockReasons: string[];
  nextStep: string;
};
