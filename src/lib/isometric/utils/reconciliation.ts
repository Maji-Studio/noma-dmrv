import {
  findDatapointBySupplierRef,
  findGhgEntryBySupplierRef,
} from "../submissions";
import {
  listGhgStatementsForProject,
  matchGhgStatementForCreate,
  type GhgStatementStatus,
} from "../ghg-statements";
import type { IsometricClient } from "../client";

export type SupplierRefReconciliation =
  | { found: false }
  | { found: true; externalId: string };

export type GhgStatementReconciliation =
  | { found: false }
  | { found: "single"; externalId: string; status: GhgStatementStatus }
  | { found: "multiple"; ids: string[] }
  | { found: "refused"; externalId: string; status: GhgStatementStatus };

export async function reconcileRemoval(client: IsometricClient, args: {
  supplierRefId: string;
}): Promise<SupplierRefReconciliation> {
  const ghgEntry = await findGhgEntryBySupplierRef(client, args.supplierRefId);
  return ghgEntry ? { found: true, externalId: ghgEntry.id } : { found: false };
}

export async function reconcileDatapoint(client: IsometricClient, args: {
  supplierRefId: string;
}): Promise<SupplierRefReconciliation> {
  const datapoint = await findDatapointBySupplierRef(client, args.supplierRefId);
  return datapoint
    ? { found: true, externalId: datapoint.id }
    : { found: false };
}

export async function reconcileGhgStatement(client: IsometricClient, args: {
  projectId: string;
  endOn: string;
}): Promise<GhgStatementReconciliation> {
  const matches = (
    await listGhgStatementsForProject(
      client,
      args.projectId,
    )
  )
    .map((statement) => matchGhgStatementForCreate(statement, args.endOn))
    .filter((match) => match.behavior !== "unrelated");
  const blocking = matches.find((match) => match.behavior === "refuse");
  if (blocking) {
    return {
      found: "refused",
      externalId: blocking.statement.id,
      status: blocking.statement.status,
    };
  }
  const adoptable = matches.filter((match) => match.behavior === "adopt");
  if (adoptable.length === 0) return { found: false };
  if (adoptable.length === 1) {
    return {
      found: "single",
      externalId: adoptable[0].statement.id,
      status: adoptable[0].statement.status,
    };
  }
  return {
    found: "multiple",
    ids: adoptable.map((match) => match.statement.id),
  };
}
