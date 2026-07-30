"use server";

// Session-backed public boundary. Browser callers can submit issue IDs and a relation type,
// but never an actor/user ID; every operation resolves the active actor from the server session.

import { requireCurrentUser } from "./auth";
import {
  createIssueRelationBetweenIssuesForActor,
  createIssueRelationForActor,
  getDirectIssueRelationsForActor,
  getRelatedIssuesByTypeForActor,
  removeIssueRelationForActor,
  type CreateIssueRelationInput,
  type RelationQueryOptions,
  type RemoveIssueRelationInput,
} from "./issue-relations/service";

export async function createIssueRelation(input: CreateIssueRelationInput) {
  const actor = await requireCurrentUser();
  return createIssueRelationForActor(actor.id, input);
}

export async function createIssueRelationBetweenIssues(
  issueId: string,
  relatedIssueId: string,
) {
  const actor = await requireCurrentUser();
  return createIssueRelationBetweenIssuesForActor(actor.id, issueId, relatedIssueId);
}

export async function removeIssueRelation(input: RemoveIssueRelationInput) {
  const actor = await requireCurrentUser();
  return removeIssueRelationForActor(actor.id, input);
}

export async function getDirectIssueRelations(
  issueId: string,
  options: RelationQueryOptions = {},
) {
  const actor = await requireCurrentUser();
  return getDirectIssueRelationsForActor(actor.id, issueId, options);
}

export async function getRelatedIssuesByType(
  issueId: string,
  relationType: string,
  options: RelationQueryOptions = {},
) {
  const actor = await requireCurrentUser();
  return getRelatedIssuesByTypeForActor(actor.id, issueId, relationType, options);
}
