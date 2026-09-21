"use server";

import {
  loadCertifyContextForCreditBatch as loadCertifyContextForCreditBatchCore,
  loadRemovalCertifyContext as loadRemovalCertifyContextCore,
  loadSelectableBatchesForFacility as loadSelectableBatchesForFacilityCore,
} from "./certify-context-core";
import { loadRemovalsForFacility as loadRemovalsForFacilityCore } from "./removals-hub";
import type { ActionResult } from "@/types/actions";
import type {
  RemovalCertifyContext,
  SelectableBatchesData,
} from "./certify-context-core";
import type { RemovalsHubData } from "./removals-hub";

export type {
  FacilityCertifierFacts,
  LinkedGhgStatementStatus,
  MemberCreditBatch,
  RemovalCertifyContext,
  RemovalSubmissionContext,
  SelectableBatch,
  SelectableBatchesData,
  TransportCategory,
  TransportCoverage,
  TransportCoverageBucket,
} from "./certify-context-core";
export type { RemovalHubEntry, RemovalsHubData } from "./removals-hub";

export async function loadCertifyContextForCreditBatch(
  creditBatchId: string,
): Promise<ActionResult<RemovalCertifyContext>> {
  return loadCertifyContextForCreditBatchCore(creditBatchId);
}

export async function loadRemovalCertifyContext(
  facilityId: string,
  removalId: string,
): Promise<ActionResult<RemovalCertifyContext>> {
  return loadRemovalCertifyContextCore(facilityId, removalId);
}

export async function loadRemovalsForFacility(
  facilityId: string,
): Promise<ActionResult<RemovalsHubData>> {
  return loadRemovalsForFacilityCore(facilityId);
}

export async function loadSelectableBatchesForFacility(
  facilityId: string,
): Promise<ActionResult<SelectableBatchesData>> {
  return loadSelectableBatchesForFacilityCore(facilityId);
}
