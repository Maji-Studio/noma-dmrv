import { z } from "zod";
import { ORDER_REPRESENTATION_REVISION } from "@/config/api-rest";
import {
  orderBody, representationCheckedDelete, representationCheckedRecord, representationCheckedUpdate, withCurrentOnStale,
} from "@/lib/api/order-write-checks";
import type { ApiRouteContext } from "@/lib/api/route";
import { ORDER_GUIDANCE, REQUEST_KEY_RULE, UNTRUSTED_TEXT } from "@/lib/operations/agent-guidance";
import { validationFailed } from "@/lib/operations/errors";
import { toOperationJsonSchema } from "@/lib/operations/json-schema";
import { runOperation } from "@/lib/operations/runner";
import { guidedWriteEnvelopeSchema } from "@/lib/representations/envelopes";
import { orderRepresentationSchema, type OrderRepresentation } from "@/lib/representations/orders";
import { deleteOrderInput, recordOrderInput, updateOrderInput } from "@/schemas/order-input";
import type { WriteTool } from "./write-tools";
import { controls, parseControls, writeOptions } from "./write-controls";

const createInput = recordOrderInput.safeExtend(controls.shape);
const updateInput = updateOrderInput.safeExtend(controls.shape);
const deleteInput = deleteOrderInput.safeExtend(controls.shape);
const createContract = toOperationJsonSchema(createInput);
const updateContract = toOperationJsonSchema(updateInput);
const deleteContract = toOperationJsonSchema(deleteInput);
const itemOutput = guidedWriteEnvelopeSchema(orderRepresentationSchema);
const deleteOutput = z.union([itemOutput, z.object({ deleted: z.object({ id: z.uuid(), code: z.string() }) })]);
const annotations = { readOnlyHint: false, openWorldHint: false, idempotentHint: true } as const;
const guidance = `${REQUEST_KEY_RULE} ${UNTRUSTED_TEXT}`;
const versionGuidance = "Call get_order first and pass version as expectedVersion. A stale version fails with the current record.";

/** Include advisory warnings in text as well as the structured body when present. */
function guidedText(headline: string, body: Record<string, unknown>) {
  const warnings = (body.warnings as string[] | undefined) ?? [];
  return warnings.length ? `${headline} ${warnings.join(" ")}` : headline;
}

export const orderWriteTools: WriteTool[] = [
  {
    kind: "write", name: "record_order", scope: "orders:write", input: createInput, output: itemOutput,
    annotations: { ...annotations, destructiveHint: false },
    description: `Record one order. Call find_customers, find_customer_locations and find_formulations first, and whoami for facility ids. ${ORDER_GUIDANCE} ${guidance}`,
    async execute(context, raw) {
      const { input, dryRun, requestKey } = parseControls(raw, createContract);
      const result = await runOperation(representationCheckedRecord, context.ctx, input, writeOptions(context, dryRun, requestKey));
      return { ...result, body: orderBody(result.data) };
    },
    summarize(body, dryRun) {
      const row = body.data as OrderRepresentation;
      return guidedText(dryRun ? `Dry run: would record order ${row.code} (provisional code).` : `Recorded order ${row.code} (version ${row.version}).`, body);
    },
  },
  {
    kind: "write", name: "update_order", scope: "orders:write", input: updateInput, output: itemOutput,
    annotations: { ...annotations, destructiveHint: true },
    description: `Update an order by UUID. Send only what changes; null clears customerLocationId. Archived orders cannot be updated. ${versionGuidance} ${ORDER_GUIDANCE} ${guidance}`,
    execute: (context, raw) => mutate(context, raw, "update"),
    summarize(body, dryRun) {
      const row = body.data as OrderRepresentation;
      return guidedText(dryRun ? `Dry run: would update order ${row.code} to version ${row.version}.` : `Updated order ${row.code} to version ${row.version}.`, body);
    },
  },
  {
    kind: "write", name: "delete_order", scope: "orders:delete", input: deleteInput, output: deleteOutput,
    annotations: { ...annotations, destructiveHint: true },
    description: `Delete an order by UUID and retire its documents. Requires orders:delete. Any delivery, including an archived delivery, prevents deletion; an archived order without deliveries can be deleted. Returns deleted id and code, or data on a dry run. ${versionGuidance} ${guidance}`,
    execute: (context, raw) => mutate(context, raw, "delete"),
    summarize(body, dryRun) {
      const code = ((body.deleted ?? body.data) as { code: string }).code;
      return dryRun ? `Dry run: would delete order ${code}.` : `Deleted order ${code}.`;
    },
  },
];

async function mutate(context: ApiRouteContext, raw: unknown, kind: "update" | "delete") {
  const { input, dryRun, requestKey } = parseControls(raw, kind === "update" ? updateContract : deleteContract);
  const parsed = (kind === "update" ? updateOrderInput : deleteOrderInput).safeParse(input);
  if (!parsed.success) throw validationFailed(parsed.error);
  const { orderId, expectedVersion } = parsed.data;
  const options = writeOptions(context, dryRun, requestKey, orderId, expectedVersion, ORDER_REPRESENTATION_REVISION);
  return withCurrentOnStale(context.ctx, orderId, async () => {
    if (kind === "update") {
      const result = await runOperation(representationCheckedUpdate(orderId, ORDER_REPRESENTATION_REVISION), context.ctx, input, options);
      return { ...result, body: orderBody(result.data) };
    }
    const result = await runOperation(representationCheckedDelete(orderId, ORDER_REPRESENTATION_REVISION), context.ctx, input, options);
    return { ...result, body: dryRun ? { data: orderRepresentationSchema.parse(result.data) } : { deleted: { id: result.data.id, code: result.data.code } } };
  });
}
