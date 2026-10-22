import { createEmissionEntryInTransaction } from "@/data-access/emission-entries";
import { createEmissionEntrySchema } from "@/schemas/emission-entries";
import type { Operation } from "./runner";

export const recordEmissionEntry: Operation<typeof createEmissionEntrySchema, Awaited<ReturnType<typeof createEmissionEntryInTransaction>>> = {
  id: "record_emission_entry",
  input: createEmissionEntrySchema,
  supportsDryRun: false,
  execute: ({ ctx, tx }, input) => createEmissionEntryInTransaction(ctx, tx, input),
};
