import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeft, Save } from "lucide-react";
import { DynamicFieldForm } from "@/components/dynamic-field-form";
import {
  CheckboxField,
  EnvironmentField,
  PriorityField,
  RiskLevelField,
  RoleField,
  SelectField,
  TextAreaField,
  TextField
} from "@/components/form-controls";
import { createIssueAction } from "@/lib/actions";
import { ROLES } from "@/lib/governance";
import { displayRole } from "@/lib/i18n";

export const dynamic = "force-dynamic";

async function currentRole() {
  const cookieStore = await cookies();
  const role = cookieStore.get("dmsRole")?.value ?? "Admin";
  return ROLES.includes(role as (typeof ROLES)[number]) ? role : "Admin";
}

function tomorrowInputValue() {
  const value = new Date();
  value.setDate(value.getDate() + 3);
  return value.toISOString().slice(0, 10);
}

export default async function NewIssuePage() {
  const role = await currentRole();

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link
          href="/issues"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-line bg-white text-slate-700 hover:bg-slate-50"
          aria-label="回到議題清單"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">建立治理議題</h1>
          <p className="mt-1 text-sm text-slate-500">建立新的治理流程項目。</p>
        </div>
      </div>

      <form action={createIssueAction} className="space-y-5">
        <input type="hidden" name="actorRole" value={role} />
        <input type="hidden" name="actorName" value="MVP User" />

        <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <h2 className="text-sm font-semibold text-slate-950">基本欄位</h2>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <TextField name="title" label="標題" required />
            <TextField name="systemName" label="系統名稱" required />
            <EnvironmentField defaultValue="Production" />
            <RiskLevelField defaultValue="Medium" />
            <PriorityField defaultValue="P3" />
            <RoleField name="ownerRole" label="負責角色" defaultValue={role} />
            <TextField name="ownerName" label="負責人" defaultValue="MVP User" required />
            <TextField name="reporter" label="回報人" defaultValue="MVP User" required />
            <TextField name="dueDate" label="到期日" type="date" defaultValue={tomorrowInputValue()} required />
            <SelectField
              name="waitingRole"
              label="等候角色"
              defaultValue=""
              includeEmpty
              emptyLabel="無"
              options={ROLES}
              optionLabel={displayRole}
            />
            <div className="grid gap-3 sm:grid-cols-3 lg:col-span-2">
              <CheckboxField name="needRca" label="需要 RCA" />
              <CheckboxField name="needRiskException" label="需要風險例外" />
              <CheckboxField name="impactProduction" label="影響生產" />
            </div>
            <div className="lg:col-span-2">
              <TextAreaField name="description" label="說明" required />
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <h2 className="text-sm font-semibold text-slate-950">動態欄位</h2>
          <div className="mt-4">
            <DynamicFieldForm issueType="Hotfix" allowIssueTypeChange />
          </div>
        </section>

        <div className="flex items-center justify-end gap-3">
          <Link
            href="/issues"
            className="inline-flex h-10 items-center rounded-md border border-line bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            取消
          </Link>
          <button className="inline-flex h-10 items-center gap-2 rounded-md bg-delta-700 px-4 text-sm font-semibold text-white hover:bg-delta-800">
            <Save className="h-4 w-4" />
            建立
          </button>
        </div>
      </form>
    </div>
  );
}
