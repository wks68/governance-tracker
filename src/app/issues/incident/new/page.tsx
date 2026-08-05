import { requireCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import PageHeader from "@/components/ui/PageHeader";
import IncidentReporterStepper from "@/components/incident-intake/IncidentReporterStepper";
import ScrollDownChevron from "@/components/ui/ScrollDownChevron";

export const dynamic = "force-dynamic";

export default async function NewIncidentPage() {
  const actor = await requireCurrentUser();
  const [users, teams] = await Promise.all([
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.team.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-20">
      <PageHeader title="事件通報" description="目前只需提供已知資訊，正式分級與處理單位將由承接窗口確認。" />
      <div data-hotfix-scroll-section>
        <IncidentReporterStepper
          actor={{ id: actor.id, name: actor.name, email: actor.email }}
          candidateUsers={users}
          candidateTeams={teams}
        />
      </div>
      <ScrollDownChevron />
    </div>
  );
}
