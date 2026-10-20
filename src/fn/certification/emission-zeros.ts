"use server";
import { z } from "zod";
import { withAction } from "../with-action";
import { recordEmissionZeros, undoEmissionZeros } from "@/data-access/emission-zeros";
import { recordEmissionZerosSchema, undoEmissionZerosSchema } from "@/schemas/emission-zeros";
import { uuidSchema } from "@/schemas/helpers";
import { requireEmissionsEntriesEnabled } from "@/lib/certification/emissions-entry-gate";
import type { ActionResult } from "@/types/actions";
import { loadRemovalEmptyLines } from "./removal-empty-lines-core";

export async function recordEmissionZerosFn(input: z.input<typeof recordEmissionZerosSchema>): Promise<ActionResult<Awaited<ReturnType<typeof recordEmissionZeros>>>> {
  return withAction((ctx) => {
    requireEmissionsEntriesEnabled();
    return recordEmissionZeros(ctx, recordEmissionZerosSchema.parse(input));
  });
}
export async function undoEmissionZerosFn(input: z.input<typeof undoEmissionZerosSchema>): Promise<ActionResult<Awaited<ReturnType<typeof undoEmissionZeros>>>> {
  return withAction((ctx) => {
    requireEmissionsEntriesEnabled();
    return undoEmissionZeros(ctx, undoEmissionZerosSchema.parse(input));
  });
}
export async function getRemovalEmptyLinesFn(input: { removalId: string }): Promise<ActionResult<Awaited<ReturnType<typeof loadRemovalEmptyLines>>>> {
  return withAction((ctx) => {
    requireEmissionsEntriesEnabled();
    const data = z.object({ removalId: uuidSchema() }).parse(input);
    return loadRemovalEmptyLines(ctx, data.removalId);
  });
}
