import type { ApiContext } from "@/lib/auth/api-context";
import { ORDER_REPRESENTATION_REVISION } from "@/config/api-rest";
import { DomainError } from "@/lib/domain-errors";
import {
  deleteOrder, describeRecordedOrder, describeUpdatedOrder, recordOrder, updateOrder,
} from "@/lib/operations/orders";
import type { Operation } from "@/lib/operations/runner";
import { readApiOrder } from "@/lib/read-models/api-orders";
import { representOrder, orderRepresentationSchema, type OrderRepresentation } from "@/lib/representations/orders";
import { deleteOrderInput, recordOrderInput, updateOrderInput } from "@/schemas/order-input";
import { withCurrentOnStale as withCurrentOnStaleRepresentation } from "./write-checks";

/** The saved row as published, with the guidance the write produced. Stored as the idempotent outcome. */
export interface OrderWriteOutput {
  order: OrderRepresentation;
  /** Orders currently produce no advisory warnings. */
  warnings: string[];
}

export const representationCheckedRecord: Operation<typeof recordOrderInput, OrderWriteOutput> = {
  id: recordOrder.id,
  input: recordOrderInput,
  supportsDryRun: true,
  describe: (input, output) => describeRecordedOrder(input, output.order),
  execute: async (scope, input) => {
    const saved = await recordOrder.execute(scope, input);
    return { order: representOrder(saved), warnings: [] };
  },
};

async function checkRepresentation(scope: Parameters<typeof updateOrder.execute>[0], id: string, revision: number) {
  const row = await readApiOrder(scope.ctx, { id }, scope.tx);
  if (revision !== ORDER_REPRESENTATION_REVISION) throw new DomainError("stale_version", "The representation has changed.");
  return row;
}

export function representationCheckedUpdate(id: string, revision: number): Operation<typeof updateOrderInput, OrderWriteOutput> {
  return {
    ...updateOrder,
    describe: (input, output) => describeUpdatedOrder(input, output.order),
    execute: async (scope, input) => {
      await checkRepresentation(scope, id, revision);
      const saved = await updateOrder.execute(scope, input);
      return { order: representOrder(saved), warnings: [] };
    },
  };
}

/** Retain the deleted row in the outcome, so a dry run can show what would go. */
export function representationCheckedDelete(id: string, revision: number): Operation<typeof deleteOrderInput, OrderRepresentation> {
  return {
    ...deleteOrder,
    describe: (input) => deleteOrder.describe!(input, undefined),
    execute: async (scope, input) => {
      const row = await checkRepresentation(scope, id, revision);
      await deleteOrder.execute(scope, input);
      return row;
    },
  };
}

export async function withCurrentOnStale<T>(ctx: ApiContext, id: string, fn: () => Promise<T>): Promise<T> {
  return withCurrentOnStaleRepresentation(fn, { noun: "order", readCurrent: () => readApiOrder(ctx, { id }) });
}

/** Replays come back from JSON storage with keys reordered; the schema restores the published order. */
export function orderBody(output: OrderWriteOutput) {
  return { data: orderRepresentationSchema.parse(output.order), ...(output.warnings.length ? { warnings: output.warnings } : {}) };
}
