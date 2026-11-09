"use server";
import { z } from "zod";
import { withAction } from "../with-action";
import { uuidSchema } from "@/schemas/helpers";
import { loadRemovalSheetFacts } from "@/data-access/removal-sheet-facts";
import type { RemovalSheetFacts } from "@/lib/certification/removal-sheet-facts";
import type { ActionResult } from "@/types/actions";

export async function getRemovalSheetFactsFn(input: { removalId: string }): Promise<ActionResult<RemovalSheetFacts>> {
  return withAction(ctx => {
    const { removalId } = z.object({ removalId: uuidSchema() }).parse(input);
    return loadRemovalSheetFacts(ctx, removalId);
  });
}
