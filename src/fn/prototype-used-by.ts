"use server";

/** PROTOTYPE ONLY (Used by section round): the read behind the three variants. Delete with the prototype. */
import { z } from "zod";
import { getPrototypeUsedByGraph } from "@/data-access/prototype-used-by";
import { PROTOTYPE_USED_BY_KINDS, type PrototypeUsedByGraph } from "@/lib/prototype-used-by";
import type { ActionResult } from "@/types/actions";
import { withAction } from "./with-action";

const inputSchema = z.object({ kind: z.enum(PROTOTYPE_USED_BY_KINDS), id: z.uuid() });

export async function getPrototypeUsedByFn(kind: string, id: string): Promise<ActionResult<PrototypeUsedByGraph | null>> {
  return withAction(
    async (ctx) => {
      const input = inputSchema.parse({ kind, id });
      return getPrototypeUsedByGraph(ctx, input.kind, input.id);
    },
    { zodErrorPrefix: "Invalid record", fallbackMessage: "These records could not be loaded." },
  );
}
