import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { resolveIssueCreationScope, listSelectableApplicants } from "@/lib/team-applicant/issueCreationScope";
import NewIssueForm from "@/components/NewIssueForm";
import { listGovernanceRelationCandidatesForActor } from "@/lib/issue-relations/viewService";
import NewItemChooser from "@/components/work-management/NewItemChooser";
import PageHeader from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

const CREATE_TYPE_MAP = {
  hotfix: { issueType: "Hotfix", changeSubType: null },
  "quarterly-project": { issueType: "ChangeRelease", changeSubType: "QUARTERLY_RELEASE" },
  incident: { issueType: "Incident", changeSubType: null },
  rca: { issueType: "RCA", changeSubType: null },
} as const;

export default async function NewIssuePage({ searchParams }: { searchParams: { type?: string } }) {
  // Incident 事件通報流程新增：F01 需要的欄位（事件類型／建議事件等級／通報來源等）與通用
  // NewIssueForm 完全不同，改走自己的專屬建立頁（見 incident-ui/incidentCreation.ts），
  // 不強塞進既有通用建立表單。其餘既有 issueType（Hotfix／季度專案）維持原本路徑不變。
  if (searchParams.type === "incident") redirect("/issues/incident/new");

  const currentUser = await requireCurrentUser();
  const selected = searchParams.type && searchParams.type in CREATE_TYPE_MAP
    ? CREATE_TYPE_MAP[searchParams.type as keyof typeof CREATE_TYPE_MAP]
    : null;

  if (!selected) {
    return (
      <div className="mx-auto max-w-5xl space-y-5">
        <PageHeader title="你現在要辦理什麼？" description="請從業務用途開始選擇，系統會帶你進入既有的正確建立流程。" />
        <NewItemChooser />
      </div>
    );
  }

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
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader title="你現在要辦理什麼？" description="已選擇辦理類型；團隊與申請人範圍會依目前登入身分決定。" />
      <NewIssueForm
        actorId={currentUser.id}
        scope={scope}
        initialApplicants={initialApplicants}
        relationCandidates={relationCandidates}
        initialIssueType={selected.issueType}
        initialChangeSubType={selected.changeSubType}
      />
    </div>
  );
}
