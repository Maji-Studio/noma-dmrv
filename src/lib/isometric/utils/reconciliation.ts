import {
  findDatapointBySupplierRef,
  findGhgEntryBySupplierRef,
} from "../submissions";
import {
  findDraftGhgStatementsByPeriod,
  type GhgStatementStatus,
} from "../ghg-statements";
import type { IsometricClient } from "../client";

export type SupplierRefReconciliation =
  | { found: false }
  | { found: true; externalId: string };

export type GhgStatementReconciliation =
  | { found: false }
  | { found: "single"; externalId: string; status: GhgStatementStatus }
  | { found: "multiple"; ids: string[] };

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
  const matches = await findDraftGhgStatementsByPeriod(
    client,
    args.projectId,
    args.endOn,
  );
  if (matches.length === 0) return { found: false };
  if (matches.length === 1) {
    return {
      found: "single",
      externalId: matches[0].id,
      status: matches[0].status,
    };
  }
  return { found: "multiple", ids: matches.map((statement) => statement.id) };
}
