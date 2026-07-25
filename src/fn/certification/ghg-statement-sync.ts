"use server";

import { z } from "zod";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";
import {
  listRegistryGhgStatementsForFacility,
  reconcileGhgStatementsForFacility,
  type ReconcileRegistryGhgStatementsResult,
  type RegistryGhgStatementView,
} from "./ghg-statement-reconciliation";

const facilityIdSchema = z.uuid();

// WRITES. Only call from an explicit operator action (the "Sync" button), never
// from a query that runs on render — see loadRegistryGhgStatements below.
export async function reconcileGhgStatementsFromRegistry(
  facilityId: string,
): Promise<ActionResult<ReconcileRegistryGhgStatementsResult>> {
  return withAction(async (orgCtx) => {
    const parsedFacilityId = facilityIdSchema.parse(facilityId);
    return reconcileGhgStatementsForFacility(orgCtx, parsedFacilityId);
  });
}

// Read-only: lists the project's registry statements without reconciling
// anything locally. This is what a panel that merely *displays* the registry
// state must use.
export async function loadRegistryGhgStatements(
  facilityId: string,
): Promise<ActionResult<RegistryGhgStatementView[]>> {
  return withAction(async (orgCtx) => {
    const parsedFacilityId = facilityIdSchema.parse(facilityId);
    return listRegistryGhgStatementsForFacility(orgCtx, parsedFacilityId);
  });
}
