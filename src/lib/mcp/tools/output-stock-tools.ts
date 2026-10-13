import { canonicalUuid } from "@/lib/api/canonical-uuid";
import { recordedMovementBody, representationCheckedRecord } from "@/lib/api/output-stock-movement-write-checks";
import { OUTPUT_STOCK_GUIDANCE, REQUEST_KEY_RULE, STOCK_EFFECTS_RULE, UNTRUSTED_TEXT } from "@/lib/operations/agent-guidance";
import { toOperationJsonSchema } from "@/lib/operations/json-schema";
import { runWithStockBasisPreview } from "@/lib/operations/stock-basis-preview";
import { stockBasisWriteEnvelopeSchema } from "@/lib/representations/envelopes";
import { outputStockMovementRepresentationSchema, type OutputStockMovementRepresentation } from "@/lib/representations/output-stock-movements";
import { recordOutputStockMovementApiInput } from "@/schemas/output-stock-movement-input";
import type { WriteTool } from "./write-tools";
import { controls, parseControls, stockWriteOptions } from "./write-controls";

const recordInput = recordOutputStockMovementApiInput.safeExtend(controls.shape);
const recordContract = toOperationJsonSchema(recordInput);
const recordOutput = stockBasisWriteEnvelopeSchema(outputStockMovementRepresentationSchema);

export const outputStockWriteTools: WriteTool[] = [
  {
    kind: "write", name: "record_output_stock_movement", scope: "biochar-products:write", input: recordInput, output: recordOutput,
    annotations: { readOnlyHint: false, openWorldHint: false, idempotentHint: true, destructiveHint: true },
    description: `Record a loss or a count on a biochar or product bin, by bin UUID. A loss is wet mass that left the bin. Call whoami and find_storage_locations first. ${OUTPUT_STOCK_GUIDANCE} ${REQUEST_KEY_RULE} ${STOCK_EFFECTS_RULE} ${UNTRUSTED_TEXT}`,
    async execute(context, raw) {
      const { input, dryRun, requestKey } = parseControls(raw, recordContract);
      const bin = (input as { storageLocationId?: unknown } | null)?.storageLocationId;
      // Like REST, the bin is the idempotency target so one key cannot move two bins.
      const result = await runWithStockBasisPreview(representationCheckedRecord, context.ctx, input,
        stockWriteOptions(context, dryRun, requestKey, typeof bin === "string" ? canonicalUuid(bin) ?? bin : undefined), (data) => data.basisFingerprint);
      return { ...result, body: recordedMovementBody(result, dryRun) };
    },
    summarize(body, dryRun) {
      const row = body.data as OutputStockMovementRepresentation;
      return dryRun ? `Dry run: would record a ${row.kind} of ${row.wetMassKg} kg wet.` : `Recorded a ${row.kind} of ${row.wetMassKg} kg wet.`;
    },
  },
];
