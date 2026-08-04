// M2-A 新增：管理與選用查詢（唯讀）。
//
// Workflow 定義／版本管理是全域性的（不像 People 領域有「僅所屬 Team」的 row-level
// 範圍），一律只有 workflow.view 決定看不看得到管理畫面；沒有此能力者一律拒絕，
// 不提供部分可見的中間狀態。

import { prisma } from "../prisma";
import { hasWorkflowCapability } from "./access";
import { WorkflowAccessDeniedError, WorkflowNotFoundError } from "./types";

export async function listWorkflowDefinitionsForActor(actorId: string) {
  const canView = await hasWorkflowCapability(actorId, "workflow.view");
  if (!canView) throw new WorkflowAccessDeniedError("僅具備 workflow.view 能力者可查看 Workflow 定義清單");

  return prisma.workflowDefinition.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      versions: {
        orderBy: { versionNo: "desc" },
        select: { id: true, versionNo: true, status: true, publishedAt: true, archivedAt: true },
      },
    },
  });
}

export async function getWorkflowDefinitionDetailForActor(actorId: string, definitionId: string) {
  const canView = await hasWorkflowCapability(actorId, "workflow.view");
  if (!canView) throw new WorkflowAccessDeniedError("僅具備 workflow.view 能力者可查看 Workflow 定義");

  const definition = await prisma.workflowDefinition.findUnique({
    where: { id: definitionId },
    include: { versions: { orderBy: { versionNo: "desc" } } },
  });
  if (!definition) throw new WorkflowNotFoundError(`找不到 WorkflowDefinition：${definitionId}`);
  return definition;
}

export async function getWorkflowVersionDetailForActor(actorId: string, versionId: string) {
  const canView = await hasWorkflowCapability(actorId, "workflow.view");
  if (!canView) throw new WorkflowAccessDeniedError("僅具備 workflow.view 能力者可查看 Workflow 版本");

  const version = await prisma.workflowVersion.findUnique({
    where: { id: versionId },
    include: {
      workflowDefinition: true,
      stages: { orderBy: { sortOrder: "asc" }, include: { requirements: true, assignedTeam: true } },
      transitions: { include: { fromStage: true, toStage: true } },
    },
  });
  if (!version) throw new WorkflowNotFoundError(`找不到 WorkflowVersion：${versionId}`);
  return version;
}
