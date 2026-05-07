import { isometric } from "./client";
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
  body: CreateGhgStatementRequest,
): Promise<GhgStatement> {
  return isometric.post<GhgStatement>("/ghg_statements", body);
}

export function getGhgStatement(id: string): Promise<GhgStatement> {
  return isometric.get<GhgStatement>(`/ghg_statements/${id}`);
}

export function submitGhgStatement(
  id: string,
  body: SubmitGhgStatementRequest,
): Promise<GhgStatement> {
  return isometric.post<GhgStatement>(`/ghg_statements/${id}/submit`, body);
}

export function resubmitGhgStatement(
  id: string,
  body: ResubmitGhgStatementRequest,
): Promise<GhgStatement> {
  return isometric.post<GhgStatement>(`/ghg_statements/${id}/submit`, body);
}

export async function findDraftGhgStatementsByPeriod(
  projectId: string,
  endOn: string,
): Promise<GhgStatement[]> {
  const statements = await isometric.paginateAll<GhgStatement>(
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
