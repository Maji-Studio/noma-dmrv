"use server";
import { z } from "zod";
import { withAction } from "../with-action";
import { uuidSchema } from "@/schemas/helpers";
import { loadRemovalCarriedEntries, type RemovalCarriedEntries } from "@/data-access/removal-carried-entries";
import type { ActionResult } from "@/types/actions";

export async function getRemovalCarriedEntriesFn(input: { removalId: string }): Promise<ActionResult<RemovalCarriedEntries>> {
  return withAction(ctx => {
    const { removalId } = z.object({ removalId: uuidSchema() }).parse(input);
    return loadRemovalCarriedEntries(ctx, removalId);
  });
}
