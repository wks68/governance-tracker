"use client";

import { useState } from "react";
import TeamApplicantSelector from "@/components/team-applicant/TeamApplicantSelector";
import type { TeamOption, ApplicantOption } from "@/lib/team-applicant/teamApplicantService";

export default function EditIssueTeamApplicantField({
  teams,
  initialTeamId,
  initialApplicantId,
  initialApplicantName,
}: {
  teams: TeamOption[];
  initialTeamId: string;
  initialApplicantId: string;
  initialApplicantName: string;
}) {
  const [teamId, setTeamId] = useState(initialTeamId);
  const [applicantId, setApplicantId] = useState(initialApplicantId);
  const initialApplicants: ApplicantOption[] | undefined =
    initialTeamId && initialApplicantId ? [{ id: initialApplicantId, name: initialApplicantName, roleLabel: "" }] : undefined;

  return (
    <TeamApplicantSelector
      teams={teams}
      teamId={teamId}
      applicantId={applicantId}
      onTeamIdChange={setTeamId}
      onApplicantIdChange={setApplicantId}
      initialApplicants={initialApplicants}
    />
  );
}
