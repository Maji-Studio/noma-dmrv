import { z } from "zod";
import { FORMULATION_REPRESENTATION_REVISION } from "@/config/api-rest";
import { withCurrentOnStale } from "@/lib/api/formulation-write-checks";
import { representationCheckedDelete, representationCheckedTransition, representationCheckedUpdate } from "@/lib/api/formulation-write-operations";
import { REQUEST_KEY_RULE, UNTRUSTED_TEXT } from "@/lib/operations/agent-guidance";
import { createFormulationApi } from "@/lib/operations/formulation-api";
import { validationFailed } from "@/lib/operations/errors";
import { toOperationJsonSchema } from "@/lib/operations/json-schema";
import { runOperation } from "@/lib/operations/runner";
import { formulationRepresentationSchema, type FormulationRepresentation } from "@/lib/representations/formulations";
import { createFormulationInput, updateFormulationInput, formulationVersionInput } from "@/schemas/formulation-input";
import { controls, parseControls, writeOptions } from "./write-controls";
import type { WriteTool } from "./write-tools";

const itemOutput = z.object({ data: formulationRepresentationSchema });
const deleteOutput = z.union([itemOutput, z.object({ deleted: z.object({ id: z.uuid(), code: z.string() }) })]);
const guidance = `${REQUEST_KEY_RULE} ${UNTRUSTED_TEXT}`;
const ratioGuidance = "Ratios are shares of the solid blend from 0 to 1 with at most 6 decimals; their sum must be at most 1. Use find_feedstock_types (feedstock-types:read) to select active blend-usage feedstock types for lines. A missing blend type is added in the app first. Ratios are guidance, never masses.";
const versionGuidance = "Use find_formulations (formulations:read) for the UUID and version, then pass version as expectedVersion. Archived formulations are hidden unless archived: true.";
const commands = ["create", "update", "delete", "archive", "restore"] as const;
const descriptions = {
  create: `Create one formulation with a generated code. ${ratioGuidance}`,
  update: `Update a formulation by UUID. Restore before editing. Send only what changes; lines replaces the full list. Used lines cannot be removed. ${ratioGuidance} ${versionGuidance}`,
  delete: `Delete a formulation by UUID. Product, bin or order references prevent deletion, including archived references. An unused archived formulation can be deleted. Returns deleted id and code, or data on a dry run. ${versionGuidance}`,
  archive: `Archive a formulation by UUID. Existing records keep it; new references cannot use it. ${versionGuidance}`,
  restore: `Restore an archived formulation by UUID so it can be selected and edited again. ${versionGuidance}`,
};
const pastTense = { create: "Created", update: "Updated", delete: "Deleted", archive: "Archived", restore: "Restored" };

/** Formulation writes in the master-data workflow, exposed by credential scope. */
export const formulationWriteTools: WriteTool[] = commands.map(command => {
  const schema = command === "create" ? createFormulationInput : command === "update" ? updateFormulationInput : formulationVersionInput;
  const inputSchema = schema.safeExtend(controls.shape);
  const contract = toOperationJsonSchema(inputSchema);
  return {
    kind: "write", name: `${command}_formulation`, scope: command === "delete" ? "formulations:delete" : "formulations:write", requiredScopes: () => [command === "delete" ? "formulations:delete" : "formulations:write"],
    input: inputSchema, output: command === "delete" ? deleteOutput : itemOutput,
    annotations: { readOnlyHint: false, openWorldHint: false, idempotentHint: true, destructiveHint: command !== "create" },
    description: `${descriptions[command]} ${guidance}`,
    async execute(context, raw) {
      const { input, dryRun, requestKey } = parseControls(raw, contract);
      if (command === "create") {
        const result = await runOperation(createFormulationApi, context.ctx, input, writeOptions(context, dryRun, requestKey));
        return { ...result, body: { data: formulationRepresentationSchema.parse(result.data.formulation) } };
      }
      const parsed = schema.safeParse(input);
      if (!parsed.success) throw validationFailed(parsed.error);
      const { formulationId, expectedVersion } = parsed.data as z.infer<typeof formulationVersionInput>;
      const options = writeOptions(context, dryRun, requestKey, formulationId, expectedVersion, FORMULATION_REPRESENTATION_REVISION);
      return withCurrentOnStale(context.ctx, formulationId, async () => {
        if (command === "delete") {
          const result = await runOperation(representationCheckedDelete(formulationId, FORMULATION_REPRESENTATION_REVISION), context.ctx, input, options);
          return { ...result, body: dryRun ? { data: formulationRepresentationSchema.parse(result.data) } : { deleted: { id: result.data.id, code: result.data.code } } };
        }
        const operation = command === "update" ? representationCheckedUpdate(formulationId, FORMULATION_REPRESENTATION_REVISION)
          : representationCheckedTransition(formulationId, FORMULATION_REPRESENTATION_REVISION, command);
        const result = await runOperation(operation, context.ctx, input, options);
        return { ...result, body: { data: formulationRepresentationSchema.parse(result.data.formulation) } };
      });
    },
    summarize(body, dryRun) {
      const row = (body.data ?? body.deleted) as FormulationRepresentation;
      return dryRun ? `Dry run: would ${command} formulation ${row.code}${command === "create" ? " (provisional code)" : ""}.`
        : `${pastTense[command]} formulation ${row.code}${command === "delete" ? "" : ` (version ${row.version})`}.`;
    },
  };
});
