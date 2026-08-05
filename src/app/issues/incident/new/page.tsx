import { requireCurrentUser } from "@/lib/auth";
import PageHeader from "@/components/ui/PageHeader";
import IncidentCreateForm from "./IncidentCreateForm";
import ScrollDownChevron from "@/components/ui/ScrollDownChevron";

export const dynamic = "force-dynamic";

export default async function NewIncidentPage() {
  await requireCurrentUser();
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="事件通報" description="目前只需提供已知資訊，正式分級與處理單位將由承接窗口確認。" />
      <div data-hotfix-scroll-section>
        <IncidentCreateForm />
      </div>
      <ScrollDownChevron />
    </div>
  );
}
