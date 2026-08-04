import { requireCurrentUser } from "@/lib/auth";
import PageHeader from "@/components/ui/PageHeader";
import IncidentCreateForm from "./IncidentCreateForm";

export const dynamic = "force-dynamic";

export default async function NewIncidentPage() {
  await requireCurrentUser();
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="事件通報（F01）" description="請填寫事件基本資料後送出，將自動進入事件受理窗口待承接。" />
      <IncidentCreateForm />
    </div>
  );
}
