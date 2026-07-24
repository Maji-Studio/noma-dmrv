import type { IsometricClient } from "./client";
import type { components } from "./generated/certify";

export type CreateGhgStatementRequest =
  components["schemas"]["CreateGhgStatementRequest"];
export type SubmitGhgStatementRequest =
  components["schemas"]["SubmitGhgStatementRequest"];
export type ResubmitGhgStatementRequest =
  components["schemas"]["ResubmitGhgStatementRequest"];
type GeneratedGhgStatement = components["schemas"]["GhgStatement"];
export type GhgStatement = Omit<
  GeneratedGhgStatement,
  "reporting_period_start_at" | "reporting_period_end_at"
> & {
  // The generated schema says these are required dates, but the registry can
  // return null while a statement has not had its reporting period assigned.
  reporting_period_start_at: string | null;
  reporting_period_end_at: string | null;
  // Older/raw responses use start_on/end_on. Keep these optional at the
  // boundary and normalize them through getGhgStatementPeriod().
  start_on?: string | null;
  end_on?: string | null;
};
export type GhgStatementStatus =
  components["schemas"]["GhgStatementStatus"];

const GHG_STATEMENT_LIST_PAGE_SIZE = 50;

export interface GhgStatementPeriod {
  startOn: string | null;
  endOn: string | null;
}

export type GhgStatementCreateMatch =
  | { behavior: "unrelated"; statement: GhgStatement }
  | { behavior: "adopt"; statement: GhgStatement }
  | { behavior: "refuse"; statement: GhgStatement };

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

export async function listGhgStatementsForProject(
  client: IsometricClient,
  projectId: string,
): Promise<GhgStatement[]> {
  const statements = await client.paginateAll<GhgStatement>(
    "/ghg_statements",
    { pageSize: GHG_STATEMENT_LIST_PAGE_SIZE },
  );
  return statements.filter((statement) => statement.project_id === projectId);
}

export function getGhgStatementPeriod(
  statement: GhgStatement,
): GhgStatementPeriod {
  const raw = statement as GhgStatement & {
    reporting_period_start_at?: string | null;
    reporting_period_end_at?: string | null;
  };
  return {
    startOn:
      raw.reporting_period_start_at !== undefined
        ? raw.reporting_period_start_at
        : raw.start_on ?? null,
    endOn:
      raw.reporting_period_end_at !== undefined
        ? raw.reporting_period_end_at
        : raw.end_on ?? null,
  };
}

export function matchGhgStatementForCreate(
  statement: GhgStatement,
  requestedEndOn: string,
): GhgStatementCreateMatch {
  if (!periodMatchesRequestedEnd(statement, requestedEndOn)) {
    return { behavior: "unrelated", statement };
  }
  return statement.status === "DRAFT"
    ? { behavior: "adopt", statement }
    : { behavior: "refuse", statement };
}

export function ghgStatementCreateRefusalMessage(
  statement: Pick<GhgStatement, "id" | "status">,
): string {
  return `Registry statement ${statement.id} is ${statement.status} and already covers this reporting period. Sync from the registry and open that statement instead of creating a duplicate.`;
}

export async function findDraftGhgStatementsByPeriod(
  client: IsometricClient,
  projectId: string,
  endOn: string,
): Promise<GhgStatement[]> {
  const statements = await listGhgStatementsForProject(client, projectId);
  return statements.filter(
    (statement) =>
      getGhgStatementPeriod(statement).endOn === endOn &&
      statement.status === "DRAFT",
  );
}

function periodMatchesRequestedEnd(
  statement: GhgStatement,
  requestedEndOn: string,
): boolean {
  const period = getGhgStatementPeriod(statement);
  if (period.endOn === null) return false;
  if (period.endOn === requestedEndOn) return true;
  if (
    period.startOn !== null &&
    period.startOn <= requestedEndOn &&
    requestedEndOn <= period.endOn
  ) {
    return true;
  }
  return false;
}
