import {
  findDatapointBySupplierRef,
  findRemovalBySupplierRef,
} from "../submissions";
import {
  findDraftGhgStatementsByPeriod,
  type GhgStatementStatus,
} from "../ghg-statements";

export type SupplierRefReconciliation =
  | { found: false }
  | { found: true; externalId: string };

export type GhgStatementReconciliation =
  | { found: false }
  | { found: "single"; externalId: string; status: GhgStatementStatus }
  | { found: "multiple"; ids: string[] };

export async function reconcileRemoval(args: {
  supplierRefId: string;
}): Promise<SupplierRefReconciliation> {
  const removal = await findRemovalBySupplierRef(args.supplierRefId);
  return removal ? { found: true, externalId: removal.id } : { found: false };
}

export async function reconcileDatapoint(args: {
  supplierRefId: string;
}): Promise<SupplierRefReconciliation> {
  const datapoint = await findDatapointBySupplierRef(args.supplierRefId);
  return datapoint
    ? { found: true, externalId: datapoint.id }
    : { found: false };
}

export async function reconcileGhgStatement(args: {
  projectId: string;
  endOn: string;
}): Promise<GhgStatementReconciliation> {
  const matches = await findDraftGhgStatementsByPeriod(
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
