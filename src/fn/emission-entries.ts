"use server";
import { z } from "zod";
import { withCreate } from "./with-create";
import type { CreateIntentOptions } from "@/schemas/create-intent";
import { recordEmissionEntry } from "@/lib/operations/emission-entries";
import { withAction } from "./with-action";
import {
  type createEmissionEntry,
  updateEmissionEntry,
  confirmEmissionEntry,
  deleteEmissionEntry,
  restoreEmissionEntry,
  replaceEmissionEntry,
} from "@/data-access/emission-entries";
import { loadFacilityEmissionsOverview, type FacilityEmissionsOverview } from "@/lib/read-models/facility-emissions-overview";
import { loadBatchEmissionLines } from "@/lib/read-models/batch-emission-lines";
import type { BatchEmissionLinesResult } from "@/lib/read-models/batches-emission-lines";
import {
  createEmissionEntrySchema,
  updateEmissionEntrySchema,
  replaceEmissionEntrySchema,
  emissionEntryVersionSchema,
} from "@/schemas/emission-entries";
import { uuidSchema } from "@/schemas/helpers";
import type { ActionResult } from "@/types/actions";

export async function createEmissionEntryFn(
  input: z.input<typeof createEmissionEntrySchema>,
  options?: CreateIntentOptions,
): Promise<ActionResult<Awaited<ReturnType<typeof createEmissionEntry>>>> {
  return withCreate((_ctx, create) => create(recordEmissionEntry, createEmissionEntrySchema.parse(input)), options);
}
export async function replaceEmissionEntryFn(
  input: z.input<typeof replaceEmissionEntrySchema>,
): Promise<ActionResult<Awaited<ReturnType<typeof replaceEmissionEntry>>>> {
  return withAction((ctx) => replaceEmissionEntry(ctx, replaceEmissionEntrySchema.parse(input)));
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
): Promise<ActionResult<{ id: string; version: number }>> {
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
type BatchEmissionLinesPayload =
  | { status: "ready"; lines: Extract<BatchEmissionLinesResult, { status: "ready" }>["lines"] }
  | { status: "blocked"; blocker: Extract<BatchEmissionLinesResult, { status: "blocked" }>["blocker"] };

export async function getBatchEmissionLinesFn(input: {
  facilityId: string;
  creditBatchId: string;
}): Promise<ActionResult<BatchEmissionLinesPayload>> {
  return withAction(async (ctx) => {
    const data = z.object({ facilityId: uuidSchema(), creditBatchId: uuidSchema() }).parse(input);
    const result = await loadBatchEmissionLines(ctx, data.facilityId, data.creditBatchId);
    return result.status === "ready"
      ? { status: "ready", lines: result.lines }
      : { status: "blocked", blocker: result.blocker };
  });
}

export async function getFacilityEmissionsOverviewFn(input: {
  facilityId: string;
}): Promise<ActionResult<FacilityEmissionsOverview>> {
  return withAction((ctx) => {
    const data = z.object({ facilityId: uuidSchema() }).parse(input);
    return loadFacilityEmissionsOverview(ctx, data.facilityId);
  });
}
