"use server";

// 建立工單／團隊整合修正新增：「取消 Hotfix」——工單已進入正式處理流程後，申請人或 Admin
// 停止處理的唯一正式手段（不得直接刪除）。沿用既有 workflow-execution CANCEL Transition
// 機制（reasonCode 必填、全流程可用），不新建流程節點。

import { revalidatePath } from "next/cache";
import { requireCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAvailableIssueTransitions, cancelIssueWorkflow } from "@/lib/workflowExecutionService";
import { getUserHasCapability } from "@/lib/permissions";
import { actionOk, toActionResult, type ActionResult } from "@/lib/actionResult";

export async function cancelHotfixAction(formData: FormData): Promise<ActionResult> {
  const actor = await requireCurrentUser();
  const issueId = String(formData.get("issueId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  try {
    if (!reason) return toActionResult(new Error("取消 Hotfix 必須填寫原因"));

    const issue = await prisma.issue.findUniqueOrThrow({ where: { id: issueId } });
    const isAdmin = await getUserHasCapability(actor, "admin.full");
    if (issue.reporterUserId !== actor.id && !isAdmin) {
      return toActionResult(new Error("僅申請人本人或系統管理員可取消此 Hotfix 工單"));
    }

    const transitions = await getAvailableIssueTransitions(issueId, actor.id);
    const cancelTransition = transitions.find((t) => t.transition.transitionType === "CANCEL");
    if (!cancelTransition) {
      return toActionResult(new Error("目前階段無法取消此工單"));
    }

    await cancelIssueWorkflow({ issueId, transitionId: cancelTransition.transition.id, actorId: actor.id, reasonCode: reason });

    revalidatePath(`/issues/${issueId}`, "layout");
    return actionOk("已取消此 Hotfix 工單");
  } catch (err) {
    return toActionResult(err);
  }
}
