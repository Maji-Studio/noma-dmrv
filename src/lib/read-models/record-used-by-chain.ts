import { z } from "zod";

import { getRecordUsedByChain } from "@/data-access/record-used-by-chain";
import type { OrgContext } from "@/lib/auth/server";
import { RECORD_USED_BY_KINDS, type RecordUsedByChain } from "@/lib/record-used-by-chain";
import { uuidSchema } from "@/schemas/helpers";

const recordUsedByChainReadSchema = z.object({
  kind: z.enum(RECORD_USED_BY_KINDS),
  id: uuidSchema("Choose a valid record."),
});

export type RecordUsedByChainReadInput = z.input<typeof recordUsedByChainReadSchema>;

/** Advisory lineage for a record in the caller's organization. */
export async function readRecordUsedByChain(ctx: OrgContext, input: unknown): Promise<RecordUsedByChain | null> {
  const { kind, id } = recordUsedByChainReadSchema.parse(input);
  return getRecordUsedByChain(ctx, kind, id);
}
