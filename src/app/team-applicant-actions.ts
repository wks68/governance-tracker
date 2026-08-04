"use server";

// 建立工單／團隊整合修正新增：供 TeamApplicantSelector（Client Component）呼叫，
// 依選定的 teamId 現場查詢該團隊目前 active 成員名單。Client Component 本身不得 import
// Prisma，一律透過本檔案的 Server Action 取得資料，且一律重新以 requireCurrentUser() 解析
// actor、重新驗證 actor 是否有權使用該 teamId——不信任前端傳入的任何團隊/身分宣稱。

import { requireCurrentUser } from "@/lib/auth";
import { type TeamOption, type ApplicantOption } from "@/lib/team-applicant/teamApplicantService";
import { resolveIssueCreationScope, listSelectableApplicants } from "@/lib/team-applicant/issueCreationScope";
import { actionOk, toActionResult, type ActionResult } from "@/lib/actionResult";

export async function listCreatableTeamsForActorAction(): Promise<ActionResult<TeamOption[]>> {
  const actor = await requireCurrentUser();
  try {
    const scope = await resolveIssueCreationScope(actor.id);
    if (scope.blockedReason) return { ok: false, code: "ISSUE_CREATION_SCOPE_BLOCKED", message: scope.blockedReason };
    return actionOk("ok", scope.teams);
  } catch (err) {
    return toActionResult(err);
  }
}

export async function listApplicantsForTeamAction(teamId: string): Promise<ActionResult<ApplicantOption[]>> {
  const actor = await requireCurrentUser();
  if (!teamId) return actionOk("ok", []);
  try {
    const applicants = await listSelectableApplicants(actor.id, teamId);
    return actionOk("ok", applicants);
  } catch (err) {
    return toActionResult(err);
  }
}
