"use server";
import { z } from "zod";
import { withAction } from "./with-action";
import {
  createEmissionEntry,
  markNothingToRecord,
  updateEmissionEntry,
  confirmEmissionEntry,
  deleteEmissionEntry,
  restoreEmissionEntry,
} from "@/data-access/emission-entries";
import { loadFacilityEmissionsOverview, type FacilityEmissionsOverview } from "@/lib/read-models/facility-emissions-overview";
import { loadBatchEmissionLines } from "@/lib/read-models/batch-emission-lines";
import {
  createEmissionEntrySchema,
  markNothingToRecordSchema,
  updateEmissionEntrySchema,
  emissionEntryVersionSchema,
} from "@/schemas/emission-entries";
import { uuidSchema } from "@/schemas/helpers";
import type { ActionResult } from "@/types/actions";

export async function createEmissionEntryFn(
  input: z.input<typeof createEmissionEntrySchema>,
): Promise<ActionResult<Awaited<ReturnType<typeof createEmissionEntry>>>> {
  return withAction((ctx) => createEmissionEntry(ctx, createEmissionEntrySchema.parse(input)));
}
export async function updateEmissionEntryFn(
  input: z.input<typeof updateEmissionEntrySchema>,
): Promise<ActionResult<Awaited<ReturnType<typeof updateEmissionEntry>>>> {
  return withAction((ctx) => updateEmissionEntry(ctx, updateEmissionEntrySchema.parse(input)));
}
export async function confirmEmissionEntryFn(
  input: z.input<typeof emissionEntryVersionSchema>,
): Promise<ActionResult<Awaited<ReturnType<typeof confirmEmissionEntry>>>> {
  return withAction((ctx) => {
    const data = emissionEntryVersionSchema.parse(input);
    return confirmEmissionEntry(ctx, data.id, data.expectedVersion);
  });
}
export async function deleteEmissionEntryFn(
  input: z.input<typeof emissionEntryVersionSchema>,
): Promise<ActionResult<{ id: string }>> {
  return withAction((ctx) => {
    const data = emissionEntryVersionSchema.parse(input);
    return deleteEmissionEntry(ctx, data.id, data.expectedVersion);
  });
}
export async function restoreEmissionEntryFn(
  input: z.input<typeof emissionEntryVersionSchema>,
): Promise<ActionResult<Awaited<ReturnType<typeof restoreEmissionEntry>>>> {
  return withAction((ctx) => restoreEmissionEntry(ctx, emissionEntryVersionSchema.parse(input)));
}
export async function getBatchEmissionLinesFn(input: {
  facilityId: string;
  creditBatchId: string;
}): Promise<ActionResult<Awaited<ReturnType<typeof loadBatchEmissionLines>>>> {
  return withAction((ctx) => {
    const data = z.object({ facilityId: uuidSchema(), creditBatchId: uuidSchema() }).parse(input);
    return loadBatchEmissionLines(ctx, data.facilityId, data.creditBatchId);
  });
}

export async function markNothingToRecordFn(
  input: z.input<typeof markNothingToRecordSchema>,
): Promise<ActionResult<Awaited<ReturnType<typeof markNothingToRecord>>>> {
  return withAction((ctx) => markNothingToRecord(ctx, markNothingToRecordSchema.parse(input)));
}

export async function getFacilityEmissionsOverviewFn(input: {
  facilityId: string;
}): Promise<ActionResult<FacilityEmissionsOverview>> {
  return withAction((ctx) => {
    const data = z.object({ facilityId: uuidSchema() }).parse(input);
    return loadFacilityEmissionsOverview(ctx, data.facilityId);
  });
}
