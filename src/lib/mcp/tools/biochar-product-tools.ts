import { BIOCHAR_PRODUCT_REPRESENTATION_REVISION } from "@/config/api-rest";
import { madeProductBody, productBodyData, representationCheckedMake, representationCheckedUpdate, withCurrentOnStale } from "@/lib/api/biochar-product-write-checks";
import type { ApiRouteContext } from "@/lib/api/route";
import { BIOCHAR_PRODUCT_GUIDANCE, REQUEST_KEY_RULE, UNTRUSTED_TEXT } from "@/lib/operations/agent-guidance";
import { validationFailed } from "@/lib/operations/errors";
import { toOperationJsonSchema } from "@/lib/operations/json-schema";
import { runOperation } from "@/lib/operations/runner";
import { runWithStockBasisPreview } from "@/lib/operations/stock-basis-preview";
import { itemEnvelopeSchema, stockBasisWriteEnvelopeSchema } from "@/lib/representations/envelopes";
import { biocharProductRepresentationSchema, type BiocharProductRepresentation } from "@/lib/representations/biochar-products";
import { makeBiocharProductApiInput, updateBiocharProductToolInput } from "@/schemas/biochar-product-input";
import type { WriteTool } from "./write-tools";
import { controls, parseControls, stockWriteOptions, writeOptions } from "./write-controls";

const createInput = makeBiocharProductApiInput.safeExtend(controls.shape);
const updateInput = updateBiocharProductToolInput.safeExtend(controls.shape);
const createContract = toOperationJsonSchema(createInput);
const updateContract = toOperationJsonSchema(updateInput);
const createOutput = stockBasisWriteEnvelopeSchema(biocharProductRepresentationSchema);
const updateOutput = itemEnvelopeSchema(biocharProductRepresentationSchema);
const annotations = { readOnlyHint: false, openWorldHint: false, idempotentHint: true } as const;
const guidance = `${REQUEST_KEY_RULE} ${UNTRUSTED_TEXT}`;

export const biocharProductWriteTools: WriteTool[] = [
  {
    kind: "write", name: "make_biochar_product", scope: "biochar-products:write", input: createInput, output: createOutput,
    annotations: { ...annotations, destructiveHint: false },
    description: `Make a biochar product: draw biochar, and ingredients for a blend, from bins and place it in a product bin. Call whoami, find_formulations and find_storage_locations first. ${BIOCHAR_PRODUCT_GUIDANCE} ${guidance}`,
    async execute(context, raw) {
      const { input, dryRun, requestKey } = parseControls(raw, createContract);
      const result = await runWithStockBasisPreview(representationCheckedMake, context.ctx, input,
        stockWriteOptions(context, dryRun, requestKey), (data) => data.basisFingerprint);
      return { ...result, body: madeProductBody(result, dryRun) };
    },
    summarize(body, dryRun) {
      const row = body.data as BiocharProductRepresentation;
      return dryRun ? `Dry run: would make biochar product ${row.code} (provisional code).` : `Made biochar product ${row.code} (${row.status}).`;
    },
  },
  {
    kind: "write", name: "update_biochar_product", scope: "biochar-products:write", input: updateInput, output: updateOutput,
    annotations: { ...annotations, destructiveHint: true },
    description: `Update a biochar product by UUID. Only code, status and densityKgM3 can change; null clears the density. Call get_biochar_product first and pass version as expectedVersion. A stale version fails with the current record. ${guidance}`,
    execute: update,
    summarize(body, dryRun) {
      const row = body.data as BiocharProductRepresentation;
      return dryRun ? `Dry run: would update biochar product ${row.code} to version ${row.version}.` : `Updated biochar product ${row.code} (${row.status}) to version ${row.version}.`;
    },
  },
];

async function update(context: ApiRouteContext, raw: unknown) {
  const { input, dryRun, requestKey } = parseControls(raw, updateContract);
  const parsed = updateBiocharProductToolInput.safeParse(input);
  if (!parsed.success) throw validationFailed(parsed.error);
  const { biocharProductId, expectedVersion } = parsed.data;
  const options = writeOptions(context, dryRun, requestKey, biocharProductId, expectedVersion, BIOCHAR_PRODUCT_REPRESENTATION_REVISION);
  return withCurrentOnStale(context.ctx, biocharProductId, async () => {
    const result = await runOperation(representationCheckedUpdate(biocharProductId, BIOCHAR_PRODUCT_REPRESENTATION_REVISION), context.ctx, input, options);
    return { ...result, body: { data: productBodyData(result.data) } };
  });
}
