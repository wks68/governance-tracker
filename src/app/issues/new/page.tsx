import { requireCurrentUser } from "@/lib/auth";
import { resolveIssueCreationScope, listSelectableApplicants } from "@/lib/team-applicant/issueCreationScope";
import NewIssueForm from "@/components/NewIssueForm";
import { listGovernanceRelationCandidatesForActor } from "@/lib/issue-relations/viewService";

export const dynamic = "force-dynamic";

export default async function NewIssuePage() {
  const currentUser = await requireCurrentUser();
  const [scope, relationCandidates] = await Promise.all([
    resolveIssueCreationScope(currentUser.id),
    listGovernanceRelationCandidatesForActor(currentUser.id),
  ]);
  const initialTeamId = scope.fixedTeamId ?? "";
  const initialApplicants =
    initialTeamId && scope.canChooseApplicant && !scope.blockedReason
      ? await listSelectableApplicants(currentUser.id, initialTeamId)
      : scope.fixedApplicant
        ? [scope.fixedApplicant]
        : undefined;

  return (
    <NewIssueForm
      scope={scope}
      initialApplicants={initialApplicants}
      relationCandidates={relationCandidates}
    />
  );
}
