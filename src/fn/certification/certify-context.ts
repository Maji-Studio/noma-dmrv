"use server";

import {
  loadCertifyContextForCreditBatch as loadCertifyContextForCreditBatchCore,
  loadRemovalCertifyContext as loadRemovalCertifyContextCore,
  loadRemovalsForFacility as loadRemovalsForFacilityCore,
  loadSelectableBatchesForFacility as loadSelectableBatchesForFacilityCore,
} from "./certify-context-core";
import type { ActionResult } from "@/types/actions";
import type {
  RemovalCertifyContext,
  RemovalsHubData,
  SelectableBatchesData,
} from "./certify-context-core";

export type {
  FacilityCertifierFacts,
  LinkedGhgStatementStatus,
  MemberCreditBatch,
  RemovalCertifyContext,
  RemovalHubEntry,
  RemovalsHubData,
  RemovalSubmissionContext,
  SelectableBatch,
  SelectableBatchesData,
  TransportCategory,
  TransportCoverage,
  TransportCoverageBucket,
} from "./certify-context-core";

export async function loadCertifyContextForCreditBatch(
  creditBatchId: string,
): Promise<ActionResult<RemovalCertifyContext>> {
  return loadCertifyContextForCreditBatchCore(creditBatchId);
}

export async function loadRemovalCertifyContext(
  removalId: string,
): Promise<ActionResult<RemovalCertifyContext>> {
  return loadRemovalCertifyContextCore(removalId);
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
