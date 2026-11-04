import { CODE_CONFLICT_MESSAGES, withAutoCodes } from "@/data-access/code-generator";
import { drivers } from "@/db/schema";
import { createDriverInTransaction } from "@/data-access/quick-add";
import type { EntityOption } from "@/components/forms/entity-select/types";
import { driverQuickAddSchema } from "@/schemas/quick-add";
import type { Operation } from "./runner";

const AUTO_CODE_COUNT = 1;

export const createDriver: Operation<typeof driverQuickAddSchema, EntityOption> = {
  id: "create_driver",
  input: driverQuickAddSchema,
  supportsDryRun: false,
  execute: ({ ctx, tx }, input) => withAutoCodes(ctx, tx, "DRV", drivers, drivers.code, AUTO_CODE_COUNT,
    ([code], savepoint) => createDriverInTransaction(ctx, savepoint, { ...input, code }), CODE_CONFLICT_MESSAGES.driver),
};
