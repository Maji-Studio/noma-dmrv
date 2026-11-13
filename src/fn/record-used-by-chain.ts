"use server";

import { z } from "zod";
import { getRecordUsedByChain } from "@/data-access/record-used-by-chain";
import { RECORD_USED_BY_KINDS, type RecordUsedByChain } from "@/lib/record-used-by-chain";
import type { ActionResult } from "@/types/actions";
import { withAction } from "./with-action";

const inputSchema = z.object({ kind: z.enum(RECORD_USED_BY_KINDS), id: z.uuid() });

export async function getRecordUsedByChainFn(input: z.input<typeof inputSchema>): Promise<ActionResult<RecordUsedByChain | null>> {
  return withAction(async ctx => {
    const parsed = inputSchema.parse(input);
    return getRecordUsedByChain(ctx, parsed.kind, parsed.id);
  }, { zodErrorPrefix: "Invalid record", fallbackMessage: "These records could not be loaded." });
}
