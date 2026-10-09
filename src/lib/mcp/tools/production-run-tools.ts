import { z } from "zod";
import { PRODUCTION_RUN_REPRESENTATION_REVISION } from "@/config/api-rest";
import { checkProductionRunDraws, productionRunBody, representationCheckedStart, representationCheckedUpdate, representationCheckedDelete, withCurrentOnStale } from "@/lib/api/production-run-write-checks";
import { startProductionRun, updateProductionRun, deleteProductionRun } from "@/lib/operations/production-runs";
import { runOperation } from "@/lib/operations/runner";
import { toOperationJsonSchema } from "@/lib/operations/json-schema";
import { validationFailed } from "@/lib/operations/errors";
import { stockWriteEnvelopeSchema } from "@/lib/representations/envelopes";
import { productionRunRepresentationSchema, type ProductionRunRepresentation } from "@/lib/representations/production-runs";
import { PRODUCTION_RUN_GUIDANCE, REQUEST_KEY_RULE, UNTRUSTED_TEXT } from "@/lib/operations/agent-guidance";
import type { ApiRouteContext } from "@/lib/api/route";
import type { WriteTool } from "./write-tools";
import { controls, parseControls, writeOptions } from "./write-controls";

const createInput = startProductionRun.input.safeExtend(controls.shape);
const updateInput = updateProductionRun.input.safeExtend(controls.shape);
const deleteInput = deleteProductionRun.input.safeExtend(controls.shape);
const createContract = toOperationJsonSchema(createInput);
const updateContract = toOperationJsonSchema(updateInput);
const deleteContract = toOperationJsonSchema(deleteInput);
const itemOutput = stockWriteEnvelopeSchema(productionRunRepresentationSchema);
const deleteOutput = z.union([itemOutput, z.object({ deleted: z.object({ id: z.uuid(), code: z.string() }) })]);
const annotations = { readOnlyHint: false, openWorldHint: false, idempotentHint: true } as const;
const guidance = `${PRODUCTION_RUN_GUIDANCE} ${REQUEST_KEY_RULE} ${UNTRUSTED_TEXT}`;
const versionGuidance = "Call get_production_run first and pass version as expectedVersion. Stale versions return the current record.";

export const productionRunWriteTools: WriteTool[] = [
  {
    kind: "write", name: startProductionRun.id, scope: "production-runs:write", input: createInput, output: itemOutput,
    annotations: { ...annotations, destructiveHint: false },
    description: `Start a production run. Call whoami, find_reactors and find_storage_locations first. Draws deduct wet mass from feedstock bins. ${guidance}`,
    async execute(context, raw) {
      const { input, dryRun, requestKey } = parseControls(raw, createContract);
      checkProductionRunDraws(input);
      const result = await runOperation(representationCheckedStart, context.ctx, input, writeOptions(context, dryRun, requestKey));
      return { ...result, body: productionRunBody(result, dryRun) };
    },
    summarize(body, dryRun) {
      const row = body.data as ProductionRunRepresentation;
      return dryRun ? `Dry run: would start production run ${row.code} (provisional code).` : `Started production run ${row.code}.`;
    },
  },
  {
    kind: "write", name: updateProductionRun.id, scope: "production-runs:write", input: updateInput, output: itemOutput,
    annotations: { ...annotations, destructiveHint: true },
    description: `Update a production run by UUID, including status, draws and output. Draw changes adjust bin stock; cancellation returns its drawn stock. ${versionGuidance} ${guidance}`,
    execute: (context, raw) => mutate(context, raw, "update"),
    summarize(body, dryRun) {
      const row = body.data as ProductionRunRepresentation;
      return dryRun ? `Dry run: would update production run ${row.code} to version ${row.version}.` : `Updated production run ${row.code} to version ${row.version}.`;
    },
  },
  {
    kind: "write", name: deleteProductionRun.id, scope: "production-runs:delete", input: deleteInput, output: deleteOutput,
    annotations: { ...annotations, destructiveHint: true },
    description: `Delete a production run by UUID and return drawn stock. Dependencies may refuse deletion. Returns deleted id and code, or data on a dry run. ${versionGuidance} ${guidance}`,
    execute: (context, raw) => mutate(context, raw, "delete"),
    summarize(body, dryRun) {
      const code = ((body.deleted ?? body.data) as { code: string }).code;
      return dryRun ? `Dry run: would delete production run ${code}.` : `Deleted production run ${code}.`;
    },
  },
];

async function mutate(context: ApiRouteContext, raw: unknown, kind: "update" | "delete") {
  const { input, dryRun, requestKey } = parseControls(raw, kind === "update" ? updateContract : deleteContract);
  const parsed = (kind === "update" ? updateProductionRun.input : deleteProductionRun.input).safeParse(input);
  if (!parsed.success) throw validationFailed(parsed.error);
  checkProductionRunDraws(input);
  const { productionRunId, expectedVersion } = parsed.data;
  const options = writeOptions(context, dryRun, requestKey, productionRunId, expectedVersion, PRODUCTION_RUN_REPRESENTATION_REVISION);
  return withCurrentOnStale(context.ctx, productionRunId, async () => {
    if (kind === "update") {
      const result = await runOperation(representationCheckedUpdate(productionRunId, PRODUCTION_RUN_REPRESENTATION_REVISION), context.ctx, input, options);
      return { ...result, body: productionRunBody(result, dryRun) };
    }
    const result = await runOperation(representationCheckedDelete(productionRunId, PRODUCTION_RUN_REPRESENTATION_REVISION), context.ctx, input, options);
    return { ...result, body: dryRun ? productionRunBody(result, true) : { deleted: { id: result.data.id, code: result.data.code } } };
  });
}
