"use server";
import { z } from "zod";
import { withAction } from "../with-action";
import { uuidSchema } from "@/schemas/helpers";
import { loadRemovalRecords } from "@/data-access/removal-records";
import type { RemovalBatchRecords } from "@/lib/certification/removal-records";
import type { ActionResult } from "@/types/actions";

export async function getRemovalRecordsFn(input: { removalId: string }): Promise<ActionResult<RemovalBatchRecords[]>> {
  return withAction(ctx => {
    const { removalId } = z.object({ removalId: uuidSchema() }).parse(input);
    return loadRemovalRecords(ctx, removalId);
  });
}
