import type { IsometricClient } from "./client";
import type { components } from "./generated/certify";

export type CreateGhgStatementRequest =
  components["schemas"]["CreateGhgStatementRequest"];
export type SubmitGhgStatementRequest =
  components["schemas"]["SubmitGhgStatementRequest"];
export type ResubmitGhgStatementRequest =
  components["schemas"]["ResubmitGhgStatementRequest"];
export type GhgStatement = components["schemas"]["GhgStatement"];
export type GhgStatementStatus =
  components["schemas"]["GhgStatementStatus"];

export function createGhgStatement(
  client: IsometricClient,
  body: CreateGhgStatementRequest,
): Promise<GhgStatement> {
  return client.post<GhgStatement>("/ghg_statements", body);
}

export function getGhgStatement(client: IsometricClient, id: string): Promise<GhgStatement> {
  return client.get<GhgStatement>(`/ghg_statements/${id}`);
}

export function submitGhgStatement(
  client: IsometricClient,
  id: string,
  body: SubmitGhgStatementRequest,
): Promise<GhgStatement> {
  return client.post<GhgStatement>(`/ghg_statements/${id}/submit`, body);
}

export function resubmitGhgStatement(
  client: IsometricClient,
  id: string,
  body: ResubmitGhgStatementRequest,
): Promise<GhgStatement> {
  return client.post<GhgStatement>(`/ghg_statements/${id}/submit`, body);
}

export async function findDraftGhgStatementsByPeriod(
  client: IsometricClient,
  projectId: string,
  endOn: string,
): Promise<GhgStatement[]> {
  const statements = await client.paginateAll<GhgStatement>(
    "/ghg_statements",
    { pageSize: 50 },
  );
  return statements.filter(
    (statement) =>
      statement.project_id === projectId &&
      statement.reporting_period_end_at === endOn &&
      statement.status === "DRAFT",
  );
}
