import { createOperatorInTransaction } from "@/data-access/quick-add";
import type { EntityOption } from "@/components/forms/entity-select/types";
import { operatorQuickAddSchema } from "@/schemas/quick-add";
import type { Operation } from "./runner";

export const createOperator: Operation<typeof operatorQuickAddSchema, EntityOption> = {
  id: "create_operator",
  input: operatorQuickAddSchema,
  supportsDryRun: false,
  execute: ({ ctx, tx }, input) => createOperatorInTransaction(ctx, tx, input),
};
