import { requireCurrentUser } from "@/lib/auth";
import { listCreatableTeamsForActor } from "@/lib/team-applicant/teamApplicantService";
import NewIssueForm from "@/components/NewIssueForm";

export const dynamic = "force-dynamic";

export default async function NewIssuePage() {
  const currentUser = await requireCurrentUser();
  const teams = await listCreatableTeamsForActor(currentUser.id);

  return <NewIssueForm teams={teams} />;
}
