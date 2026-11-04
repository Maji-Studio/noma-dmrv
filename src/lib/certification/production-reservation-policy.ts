import { LOCK_TTL_MS } from "@/lib/isometric/utils/lock";
import { getMetadataValue, SUBMISSION_EXTERNAL_MUTATIONS, SUBMISSION_METADATA_KEYS } from "./submission-metadata";

export interface ProductionReservation {
  provider: string;
  submissionType: string;
  localEntityType: string;
  localEntityId: string;
  status: string;
  lockedAt: Date | null;
  metadata: unknown;
}

/** A possible or confirmed registry write protects the submission's reservations. */
export function hasPossibleExternalMutation(row: Pick<ProductionReservation, "metadata">): boolean {
  const mutation = getMetadataValue(row.metadata, SUBMISSION_METADATA_KEYS.externalMutation);
  return mutation === SUBMISSION_EXTERNAL_MUTATIONS.possible || mutation === SUBMISSION_EXTERNAL_MUTATIONS.confirmed;
}

export function isIsometricRemovalSubmission(
  row: Pick<ProductionReservation, "provider" | "submissionType" | "localEntityType">,
): boolean {
  return row.provider === "isometric" && row.submissionType === "removal" && row.localEntityType === "removal";
}

/** Shared by the reservation writer and allocation reads; unknown reservations stay protected. */
export function canTransferProductionReservation(
  row: ProductionReservation | undefined,
  nowMs: number,
): boolean {
  if (!row) return false;
  if (!isIsometricRemovalSubmission(row)) return false;
  if (hasPossibleExternalMutation(row)) return false;
  if (row.status === "rejected" || row.status === "superseded") return true;
  if (row.status !== "draft") return false;
  const lockedAtMs = row.lockedAt?.getTime() ?? 0;
  return nowMs - lockedAtMs >= LOCK_TTL_MS;
}

