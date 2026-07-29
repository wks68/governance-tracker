"use client";

import { useState } from "react";
import TeamApplicantSelector from "@/components/team-applicant/TeamApplicantSelector";
import type { ApplicantOption } from "@/lib/team-applicant/teamApplicantService";
import type { IssueCreationScope } from "@/lib/team-applicant/issueCreationScope";

export default function EditIssueTeamApplicantField({
  scope,
  initialTeamId,
  initialApplicantId,
  initialApplicants,
}: {
  scope: IssueCreationScope;
  initialTeamId: string;
  initialApplicantId: string;
  initialApplicants?: ApplicantOption[];
}) {
  const [teamId, setTeamId] = useState(scope.fixedTeamId ?? initialTeamId);
  const [applicantId, setApplicantId] = useState(scope.fixedApplicant?.id ?? initialApplicantId);

  return (
    <TeamApplicantSelector
      teams={scope.teams}
      teamId={teamId}
      applicantId={applicantId}
      onTeamIdChange={setTeamId}
      onApplicantIdChange={setApplicantId}
      initialApplicants={initialApplicants}
      fixedTeamId={scope.fixedTeamId}
      fixedApplicant={scope.fixedApplicant}
      canChooseApplicant={scope.canChooseApplicant}
      notice={scope.notice}
      blockedReason={scope.blockedReason}
    />
  );
}
