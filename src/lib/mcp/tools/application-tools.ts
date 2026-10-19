import { z } from "zod";
import { APPLICATION_REPRESENTATION_REVISION } from "@/config/api-rest";
import { applicationBody, representationCheckedRecord, representationCheckedUpdate, representationCheckedDelete, withCurrentOnStale } from "@/lib/api/application-write-checks";
import { readApplicationListFromInput } from "@/lib/api/applications-queries";
import { lookupIdentifier } from "@/lib/api/lookup-query";
import { parseQueryInput } from "@/lib/api/query";
import { resourceQueries } from "@/lib/api/query-schemas";
import type { ApiRouteContext } from "@/lib/api/route";
import { APPLICATION_GUIDANCE, REQUEST_KEY_RULE, UNTRUSTED_TEXT } from "@/lib/operations/agent-guidance";
import { validationFailed } from "@/lib/operations/errors";
import { toOperationJsonSchema } from "@/lib/operations/json-schema";
import { runOperation } from "@/lib/operations/runner";
import { readApiApplication } from "@/lib/read-models/api-applications";
import { readApiDeliveryApplicationBalance } from "@/lib/read-models/api-delivery-application-balance";
import { applicationRepresentationSchema, type ApplicationRepresentation } from "@/lib/representations/applications";
import { applicationWriteEnvelopeSchema } from "@/lib/representations/application-writes";
import { deliveryApplicationBalanceRepresentationSchema } from "@/lib/representations/delivery-application-balance";
import { itemEnvelopeSchema, listEnvelopeSchema } from "@/lib/representations/envelopes";
import { recordApplicationApiInput, updateApplicationApiOperationInput } from "@/schemas/application-api-input";
import { deleteApplicationInput } from "@/schemas/application-input";
import type { ReadTool } from "./read-tools";
import type { WriteTool } from "./write-tools";
import { controls, parseControls, writeOptions } from "./write-controls";

const applicationIdentifier = resourceQueries.applications.get.extend({ idOrCode: z.string().describe("Application UUID or exact code from find_applications.") });
const deliveryIdentifier = resourceQueries.deliveries.get.extend({ idOrCode: z.string().describe("Delivery UUID or exact code from find_deliveries.") });
export const applicationReadTools: ReadTool[] = [
  {
    kind: "read", name: "find_applications", scope: "applications:read", requiredScopes: () => ["applications:read"], input: resourceQueries.applications.list,
    output: listEnvelopeSchema(applicationRepresentationSchema),
    description: `Find applications with the REST list filters. creditBatchId follows physical lineage, including mix-bin applications held out of credit batches. Dates are calendar dates; appliedFrom is inclusive and appliedBefore exclusive. ${UNTRUSTED_TEXT}`,
    execute: (ctx, raw) => readApplicationListFromInput(ctx, parseQueryInput(raw, resourceQueries.applications.list)),
    summarize(body) { const count = (body.data as unknown[]).length; return `${count} ${count === 1 ? "application" : "applications"}.${body.nextCursor ? " More results: pass nextCursor." : ""}`; },
  },
  {
    kind: "read", name: "get_application", scope: "applications:read", requiredScopes: () => ["applications:read"], input: applicationIdentifier,
    output: itemEnvelopeSchema(applicationRepresentationSchema),
    description: `Get an application and its version by UUID or exact code from find_applications. Pass version as expectedVersion to update_application or delete_application. Full geometry is not in this result; read REST /applications/{idOrCode}/boundary for it. ${UNTRUSTED_TEXT}`,
    async execute(ctx, raw) { const { idOrCode } = parseQueryInput(raw, applicationIdentifier); return { data: await readApiApplication(ctx, lookupIdentifier(idOrCode)) }; },
    summarize: body => { const row = body.data as ApplicationRepresentation; return `Application ${row.code}, version ${row.version}.`; },
  },
  {
    kind: "read", name: "get_delivery_application_balance", scope: "deliveries:read", requiredScopes: () => ["deliveries:read"], input: deliveryIdentifier,
    output: itemEnvelopeSchema(deliveryApplicationBalanceRepresentationSchema),
    description: `Read delivered, applied and remaining wet kg, earliest application date and site defaults from one snapshot. Call find_deliveries first for the delivery idOrCode. Call this before record_application. Requires deliveries:read. Application writes change this balance without changing the delivery version; it is not a reservation. ${UNTRUSTED_TEXT}`,
    execute(ctx, raw) { const { idOrCode } = parseQueryInput(raw, deliveryIdentifier); return readApiDeliveryApplicationBalance(ctx, lookupIdentifier(idOrCode)); },
    summarize: body => `Delivery application balance: ${(body.data as z.infer<typeof deliveryApplicationBalanceRepresentationSchema>).remainingWetMassKg} wet kg remaining.`,
  },
];

const createInput = recordApplicationApiInput.safeExtend(controls.shape);
const updateInput = updateApplicationApiOperationInput.safeExtend(controls.shape);
const deleteInput = deleteApplicationInput.safeExtend(controls.shape);
const createContract = toOperationJsonSchema(createInput);
const updateContract = toOperationJsonSchema(updateInput);
const deleteContract = toOperationJsonSchema(deleteInput);
const deleteOutput = z.union([itemEnvelopeSchema(applicationRepresentationSchema), z.object({ deleted: z.object({ id: z.uuid(), code: z.string() }) })]);
const annotations = { readOnlyHint: false, openWorldHint: false, idempotentHint: true } as const;
const guidance = `${REQUEST_KEY_RULE} ${UNTRUSTED_TEXT}`;
const versionGuidance = "Call get_application first and pass version as expectedVersion. A stale version fails with the current record.";
function guidedText(headline: string, body: Record<string, unknown>) {
  return [headline, ...((body.warnings as string[] | undefined) ?? [])].join(" ");
}
export const applicationWriteTools: WriteTool[] = [
  {
    kind: "write", name: "record_application", scope: "applications:write", requiredScopes: () => ["applications:write"], input: createInput, output: applicationWriteEnvelopeSchema,
    annotations: { ...annotations, destructiveHint: false },
    description: `Record one field application; an application is not a delivery. ${APPLICATION_GUIDANCE} ${guidance}`,
    async execute(context, raw) {
      const { input, dryRun, requestKey } = parseControls(raw, createContract);
      const result = await runOperation(representationCheckedRecord, context.ctx, input, writeOptions(context, dryRun, requestKey));
      return { ...result, body: applicationBody(result.data) };
    },
    summarize(body, dryRun) { const row = body.data as ApplicationRepresentation; return guidedText(dryRun ? `Dry run: would record application ${row.code} (provisional code).` : `Recorded application ${row.code} (version ${row.version}).`, body); },
  },
  {
    kind: "write", name: "update_application", scope: "applications:write", requiredScopes: () => ["applications:write"], input: updateInput, output: applicationWriteEnvelopeSchema,
    annotations: { ...annotations, destructiveHint: true },
    description: `Update an application by UUID. Send only changed fields; omission preserves values and null clears clearable fields. Updates never copy site defaults. Repointing to another delivery rebuilds allocations. Supply raw GeoJSON for boundaries. ${versionGuidance} ${guidance}`,
    execute: (context, raw) => mutate(context, raw, "update"),
    summarize(body, dryRun) { const row = body.data as ApplicationRepresentation; return guidedText(dryRun ? `Dry run: would update application ${row.code} to version ${row.version}.` : `Updated application ${row.code} to version ${row.version}.`, body); },
  },
  {
    kind: "write", name: "delete_application", scope: "applications:delete", requiredScopes: () => ["applications:delete"], input: deleteInput, output: deleteOutput,
    annotations: { ...annotations, destructiveHint: true },
    description: `Delete an application by UUID and retire its documents. Requires applications:delete. Certification locks may prevent deletion. Returns deleted id and code, or data on a dry run. ${versionGuidance} ${guidance}`,
    execute: (context, raw) => mutate(context, raw, "delete"),
    summarize(body, dryRun) { const { code } = (body.deleted ?? body.data) as { code: string }; return dryRun ? `Dry run: would delete application ${code}.` : `Deleted application ${code}.`; },
  },
];
async function mutate(context: ApiRouteContext, raw: unknown, kind: "update" | "delete") {
  const { input, dryRun, requestKey } = parseControls(raw, kind === "update" ? updateContract : deleteContract);
  const parsed = (kind === "update" ? updateApplicationApiOperationInput : deleteApplicationInput).safeParse(input);
  if (!parsed.success) throw validationFailed(parsed.error);
  const { applicationId, expectedVersion } = parsed.data;
  const options = writeOptions(context, dryRun, requestKey, applicationId, expectedVersion, APPLICATION_REPRESENTATION_REVISION);
  return withCurrentOnStale(context.ctx, applicationId, async () => {
    if (kind === "update") {
      const result = await runOperation(representationCheckedUpdate(applicationId, APPLICATION_REPRESENTATION_REVISION), context.ctx, input, options);
      return { ...result, body: applicationBody(result.data) };
    }
    const result = await runOperation(representationCheckedDelete(applicationId, APPLICATION_REPRESENTATION_REVISION), context.ctx, input, options);
    return { ...result, body: dryRun ? { data: applicationRepresentationSchema.parse(result.data) } : { deleted: { id: result.data.id, code: result.data.code } } };
  });
}
