"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentUser } from "@/lib/auth";
import { reassignHotfixTeamApplicant } from "@/lib/hotfix-ui/adminReassignService";
import { actionOk, toActionResult, type ActionResult } from "@/lib/actionResult";

export async function reassignHotfixTeamApplicantAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = String(formData.get("issueId") ?? "");
  const newTeamId = String(formData.get("teamId") ?? "");
  const newApplicantId = String(formData.get("applicantId") ?? "");
  const reasonCode = String(formData.get("reasonCode") ?? "");

  try {
    await reassignHotfixTeamApplicant({ issueId, actorId: actor.id, newTeamId, newApplicantId, reasonCode });
    revalidatePath(`/issues/${issueId}`, "layout");
    return actionOk("已更新團隊／申請人");
  } catch (err) {
    return toActionResult(err);
  }
}
