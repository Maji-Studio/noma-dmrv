import { startNewProductionProcessInTransaction } from "@/data-access/production-processes";
import { startNewProcessSchema } from "@/schemas/production-process";
import type { Operation } from "./runner";

export const startNewProductionProcess: Operation<typeof startNewProcessSchema, Awaited<ReturnType<typeof startNewProductionProcessInTransaction>>> = {
  id: "start_new_production_process",
  input: startNewProcessSchema,
  supportsDryRun: false,
  execute: ({ ctx, tx }, input) => startNewProductionProcessInTransaction(ctx, tx, input),
};
