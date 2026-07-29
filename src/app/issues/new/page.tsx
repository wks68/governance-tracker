import { requireCurrentUser } from "@/lib/auth";
import { resolveIssueCreationScope, listSelectableApplicants } from "@/lib/team-applicant/issueCreationScope";
import NewIssueForm from "@/components/NewIssueForm";

export const dynamic = "force-dynamic";

export default async function NewIssuePage() {
  const currentUser = await requireCurrentUser();
  const scope = await resolveIssueCreationScope(currentUser.id);
  const initialTeamId = scope.fixedTeamId ?? "";
  const initialApplicants =
    initialTeamId && scope.canChooseApplicant && !scope.blockedReason
      ? await listSelectableApplicants(currentUser.id, initialTeamId)
      : scope.fixedApplicant
        ? [scope.fixedApplicant]
        : undefined;

  return <NewIssueForm scope={scope} initialApplicants={initialApplicants} />;
}
