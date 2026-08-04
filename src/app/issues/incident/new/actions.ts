"use server";

import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { createIncidentForActor } from "@/lib/incident-ui/incidentCreation";
import { incidentRoute } from "@/lib/incident-ui/incidentStage";
import { toActionResult, type ActionResult } from "@/lib/actionResult";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function createIncidentAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  let issueId: string;
  try {
    const created = await createIncidentForActor(actor, {
      title: str(formData, "title"),
      description: str(formData, "description"),
      systemName: str(formData, "systemName"),
      environment: str(formData, "environment"),
      incidentType: str(formData, "incidentType"),
      occurredAt: str(formData, "occurredAt"),
      reportSource: str(formData, "reportSource"),
      suggestedSeverity: str(formData, "suggestedSeverity"),
      isOngoing: str(formData, "isOngoing") === "是",
      hasWorkaround: str(formData, "hasWorkaround") === "是",
      affectedScope: str(formData, "affectedScope"),
      impactSummary: str(formData, "impactSummary"),
    });
    issueId = created.id;
  } catch (err) {
    return toActionResult(err, "建立事件通報失敗，請稍後再試");
  }
  redirect(incidentRoute(issueId));
}
