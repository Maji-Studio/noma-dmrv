import { z } from "zod";
import { LAB_SAMPLE_REPRESENTATION_REVISION } from "@/config/api-rest";
import {
  labSampleBody, representationCheckedDelete, representationCheckedRecord, representationCheckedUpdate, withCurrentOnStale,
} from "@/lib/api/lab-sample-write-checks";
import type { ApiRouteContext } from "@/lib/api/route";
import { LAB_SAMPLE_GUIDANCE, REQUEST_KEY_RULE, UNTRUSTED_TEXT } from "@/lib/operations/agent-guidance";
import { validationFailed } from "@/lib/operations/errors";
import { toOperationJsonSchema } from "@/lib/operations/json-schema";
import { runOperation } from "@/lib/operations/runner";
import { guidedWriteEnvelopeSchema } from "@/lib/representations/envelopes";
import { labSampleRepresentationSchema, type LabSampleRepresentation } from "@/lib/representations/lab-samples";
import { deleteLabSampleInput, recordLabSampleInput, updateLabSampleInput } from "@/schemas/lab-sample-input";
import type { WriteTool } from "./write-tools";
import { controls, parseControls, writeOptions } from "./write-controls";

const createInput = recordLabSampleInput.safeExtend(controls.shape);
const updateInput = updateLabSampleInput.safeExtend(controls.shape);
const deleteInput = deleteLabSampleInput.safeExtend(controls.shape);
const createContract = toOperationJsonSchema(createInput);
const updateContract = toOperationJsonSchema(updateInput);
const deleteContract = toOperationJsonSchema(deleteInput);
const itemOutput = guidedWriteEnvelopeSchema(labSampleRepresentationSchema);
const deleteOutput = z.union([itemOutput, z.object({ deleted: z.object({ id: z.uuid(), code: z.string() }) })]);
const annotations = { readOnlyHint: false, openWorldHint: false, idempotentHint: true } as const;
const guidance = `${REQUEST_KEY_RULE} ${UNTRUSTED_TEXT}`;
const versionGuidance = "Call get_lab_sample first and pass version as expectedVersion. A stale version fails with the current record.";

/** The reply text repeats the calculated-ratio notices and certification warnings, so a client that shows only text still tells the user. */
function guidedText(headline: string, body: Record<string, unknown>) {
  const warnings = (body.warnings as string[] | undefined) ?? [];
  return warnings.length ? `${headline} ${warnings.join(" ")}` : headline;
}

export const labSampleWriteTools: WriteTool[] = [
  {
    kind: "write", name: "record_lab_sample", scope: "lab-samples:write", input: createInput, output: itemOutput,
    annotations: { ...annotations, destructiveHint: false },
    description: `Record one lab sample, a single replicate of one credit batch. Call whoami and find_credit_batches first. Take at least three replicates per batch. Total and organic carbon are required. ${LAB_SAMPLE_GUIDANCE} ${guidance}`,
    async execute(context, raw) {
      const { input, dryRun, requestKey } = parseControls(raw, createContract);
      const result = await runOperation(representationCheckedRecord, context.ctx, input, writeOptions(context, dryRun, requestKey));
      return { ...result, body: labSampleBody(result.data) };
    },
    summarize(body, dryRun) {
      const row = body.data as LabSampleRepresentation;
      return guidedText(dryRun ? `Dry run: would record lab sample ${row.code} (provisional code).` : `Recorded lab sample ${row.code} (version ${row.version}).`, body);
    },
  },
  {
    kind: "write", name: "update_lab_sample", scope: "lab-samples:write", input: updateInput, output: itemOutput,
    annotations: { ...annotations, destructiveHint: true },
    description: `Update a lab sample by UUID. Send only what changes; null clears an optional result, and the carbon totals cannot be cleared. Send another creditBatchId to move it. ${versionGuidance} ${LAB_SAMPLE_GUIDANCE} ${guidance}`,
    execute: (context, raw) => mutate(context, raw, "update"),
    summarize(body, dryRun) {
      const row = body.data as LabSampleRepresentation;
      return guidedText(dryRun ? `Dry run: would update lab sample ${row.code} to version ${row.version}.` : `Updated lab sample ${row.code} to version ${row.version}.`, body);
    },
  },
  {
    kind: "write", name: "delete_lab_sample", scope: "lab-samples:delete", input: deleteInput, output: deleteOutput,
    annotations: { ...annotations, destructiveHint: true },
    description: `Delete a lab sample by UUID, with its transport legs and documents. A sample in a certified output cannot be deleted. Returns deleted id and code, or data on a dry run. ${versionGuidance} ${guidance}`,
    execute: (context, raw) => mutate(context, raw, "delete"),
    summarize(body, dryRun) {
      const code = ((body.deleted ?? body.data) as { code: string }).code;
      return dryRun ? `Dry run: would delete lab sample ${code}.` : `Deleted lab sample ${code}.`;
    },
  },
];

async function mutate(context: ApiRouteContext, raw: unknown, kind: "update" | "delete") {
  const { input, dryRun, requestKey } = parseControls(raw, kind === "update" ? updateContract : deleteContract);
  const parsed = (kind === "update" ? updateLabSampleInput : deleteLabSampleInput).safeParse(input);
  if (!parsed.success) throw validationFailed(parsed.error);
  const { labSampleId, expectedVersion } = parsed.data;
  const options = writeOptions(context, dryRun, requestKey, labSampleId, expectedVersion, LAB_SAMPLE_REPRESENTATION_REVISION);
  return withCurrentOnStale(context.ctx, labSampleId, async () => {
    if (kind === "update") {
      const result = await runOperation(representationCheckedUpdate(labSampleId, LAB_SAMPLE_REPRESENTATION_REVISION), context.ctx, input, options);
      return { ...result, body: labSampleBody(result.data) };
    }
    const result = await runOperation(representationCheckedDelete(labSampleId, LAB_SAMPLE_REPRESENTATION_REVISION), context.ctx, input, options);
    return { ...result, body: dryRun ? { data: labSampleRepresentationSchema.parse(result.data) } : { deleted: { id: result.data.id, code: result.data.code } } };
  });
}
