import { CODE_CONFLICT_MESSAGES, withAutoCodes } from "@/data-access/code-generator";
import { createReactorInTransaction } from "@/data-access/reactors";
import { reactors, type Reactor } from "@/db/schema";
import { createReactorSchema } from "@/schemas/reactors";
import type { Operation } from "./runner";

const AUTO_CODE_COUNT = 1;

/** App-only settings/sheet create; the runner owns the transaction. */
export const createReactor: Operation<typeof createReactorSchema, Reactor> = {
  id: "create_reactor",
  input: createReactorSchema,
  supportsDryRun: false,
  execute: ({ ctx, tx }, input) => withAutoCodes(
    ctx, tx, "R", reactors, reactors.code, AUTO_CODE_COUNT,
    ([code], savepoint) => createReactorInTransaction(ctx, savepoint, {
      code,
      identifier: input.identifier,
      facilityId: input.facilityId,
      reactorType: input.reactorType,
      nominalThroughputTph: input.nominalThroughputTph ?? null,
      specifications: input.specifications ?? null,
    }),
    CODE_CONFLICT_MESSAGES.reactor,
  ),
};
