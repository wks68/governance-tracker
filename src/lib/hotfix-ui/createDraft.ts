export const CLIENT_ISSUE_DRAFT_VERSION = 1 as const;

export interface ClientIssueDraft {
  version: typeof CLIENT_ISSUE_DRAFT_VERSION;
  savedAt: string;
  fields: Record<string, string[]>;
}

export function issueCreateDraftStorageKey(actorId: string, issueType: string): string {
  return `dms:issue-create-draft:${actorId}:${issueType}`;
}

// Client-only draft snapshots deliberately exclude File values. Rich-text image Files remain
// attached to the mounted editor until the user leaves the page; they are never uploaded and
// never become Evidence/Attachment rows merely because the user clicks "暫存".
export function snapshotClientIssueDraft(formData: FormData): ClientIssueDraft {
  const fields: Record<string, string[]> = {};
  for (const [name, value] of formData.entries()) {
    if (typeof value !== "string" || name.startsWith("richTextImage:")) continue;
    (fields[name] ??= []).push(value);
  }
  return {
    version: CLIENT_ISSUE_DRAFT_VERSION,
    savedAt: new Date().toISOString(),
    fields,
  };
}

export function parseClientIssueDraft(value: string | null): ClientIssueDraft | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<ClientIssueDraft>;
    if (parsed.version !== CLIENT_ISSUE_DRAFT_VERSION || !parsed.fields || typeof parsed.fields !== "object") return null;
    const fields: Record<string, string[]> = {};
    for (const [name, values] of Object.entries(parsed.fields)) {
      if (!Array.isArray(values) || !values.every((entry) => typeof entry === "string")) return null;
      fields[name] = values;
    }
    return {
      version: CLIENT_ISSUE_DRAFT_VERSION,
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : "",
      fields,
    };
  } catch {
    return null;
  }
}
