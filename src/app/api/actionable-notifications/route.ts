import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getUserHasCapability } from "@/lib/permissions";
import { listWorkflowTaskNotificationsForActor } from "@/lib/workflowExecutionService";

export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await getCurrentUser();
  if (!actor) {
    return NextResponse.json(
      { error: "UNAUTHORIZED" },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  if (!(await getUserHasCapability(actor, "issue.view"))) {
    return NextResponse.json(
      { error: "FORBIDDEN" },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const tasks = await listWorkflowTaskNotificationsForActor(actor.id);
  return NextResponse.json(
    { tasks, generatedAt: new Date().toISOString() },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } },
  );
}
