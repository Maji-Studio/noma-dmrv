import { z } from "zod";
import { API_IDEMPOTENCY_KEY_MAX_LENGTH, FEEDSTOCK_REPRESENTATION_REVISION } from "@/config/api-rest";
import type { ApiRouteContext } from "@/lib/api/route";
import type { ApiScope } from "@/lib/auth/api-scopes";
import { ApiHttpError } from "@/lib/api/http-error";
import { IDEMPOTENCY_KEY_PATTERN } from "@/lib/api/request-body";
import { representationEtag } from "@/lib/api/etag";
import { rejectUnknownFields } from "@/lib/api/unknown-fields";
import { checkFeedstockAllocations, feedstockCreateBody, remainingDeadlineMs, representationCheckedUpdate, representationCheckedDelete, withCurrentOnStale } from "@/lib/api/feedstock-write-checks";
import { validationFailed } from "@/lib/operations/errors";
import { logFeedstockDelivery, updateFeedstock, deleteFeedstock } from "@/lib/operations/feedstocks";
import { runOperation } from "@/lib/operations/runner";
import { toOperationJsonSchema, type JsonSchema } from "@/lib/operations/json-schema";
import { feedstockCreateEnvelopeSchema, stockWriteEnvelopeSchema } from "@/lib/representations/envelopes";
import { feedstockRepresentationSchema, representFeedstock } from "@/lib/representations/feedstocks";
import { FEEDSTOCK_DATES, FEEDSTOCK_UNITS, REQUEST_KEY_RULE, UNTRUSTED_TEXT } from "@/lib/operations/agent-guidance";

const controls = z.object({
  dryRun: z.boolean().optional().default(false).describe("Preview without saving changes."),
  requestKey: z.string().min(1).max(API_IDEMPOTENCY_KEY_MAX_LENGTH).regex(IDEMPOTENCY_KEY_PATTERN)
    .optional().describe(REQUEST_KEY_RULE),
});
const createInput = logFeedstockDelivery.input.safeExtend(controls.shape);
const updateInput = updateFeedstock.input.safeExtend(controls.shape);
const deleteInput = deleteFeedstock.input.safeExtend(controls.shape);
const createContract = toOperationJsonSchema(createInput);
const updateContract = toOperationJsonSchema(updateInput);
const deleteContract = toOperationJsonSchema(deleteInput);
const itemOutput = stockWriteEnvelopeSchema(feedstockRepresentationSchema);
const deleteOutput = z.union([itemOutput, z.object({ deleted: z.object({ id: z.uuid(), code: z.string() }) })]);

export interface WriteTool {
  kind: "write";
  name: string;
  scope: ApiScope;
  description: string;
  input: z.ZodType;
  output: z.ZodType;
  annotations: { readOnlyHint: false; openWorldHint: false; destructiveHint: boolean; idempotentHint: true };
  execute: (context: ApiRouteContext, raw: unknown) => Promise<{
    body: Record<string, unknown>; dryRun: boolean; replayed: boolean;
  }>;
  summarize: (body: Record<string, unknown>, dryRun: boolean) => string;
}

function parseControls(raw: unknown, contract: JsonSchema) {
  rejectUnknownFields(raw, contract);
  const object = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const { requestKey, dryRun, ...input } = object;
  const key = controls.shape.requestKey.safeParse(requestKey);
  if (!key.success || (requestKey === undefined && dryRun !== true)) {
    const code = requestKey === undefined ? "idempotency_key_required" : "idempotency_key_invalid";
    const detail = requestKey === undefined ? "Send a requestKey for this write."
      : `Use 1 to ${API_IDEMPOTENCY_KEY_MAX_LENGTH} visible ASCII characters for requestKey.`;
    throw new ApiHttpError(400, code, detail, undefined, [{ code: "custom", path: ["requestKey"], message: detail }]);
  }
  const parsed = controls.safeParse({ requestKey, dryRun });
  if (!parsed.success) throw validationFailed(parsed.error);
  return { ...parsed.data, input: raw === object ? input : raw };
}

function options(context: ApiRouteContext, dryRun: boolean, key?: string, target?: string, version?: number) {
  return {
    deadlineMs: remainingDeadlineMs(context.deadlineAt), dryRun,
    audit: { requestId: context.requestId, credentialId: context.ctx.credentialId, transport: "mcp" as const },
    idempotency: key ? { credentialId: context.ctx.credentialId, key,
      ...(target ? { target, precondition: representationEtag(version!, FEEDSTOCK_REPRESENTATION_REVISION) } : {}),
    } : undefined,
  };
}

const annotations = { readOnlyHint: false, openWorldHint: false, idempotentHint: true } as const;
const writeGuidance = `${FEEDSTOCK_UNITS} ${FEEDSTOCK_DATES} ${REQUEST_KEY_RULE} ${UNTRUSTED_TEXT}`;
const versionGuidance = "Call get_feedstock first for version and pass it as expectedVersion. A stale version fails with the current record.";

export const writeTools: WriteTool[] = [
  {
    kind: "write", name: logFeedstockDelivery.id, scope: "feedstocks:write", input: createInput, output: feedstockCreateEnvelopeSchema,
    annotations: { ...annotations, destructiveHint: false },
    description: `Log a feedstock delivery. Call whoami, find_suppliers, find_feedstock_types and find_storage_locations first. Adds the wet mass to each receiving bin. ${writeGuidance}`,
    async execute(context, raw) {
      const { input, dryRun, requestKey } = parseControls(raw, createContract);
      checkFeedstockAllocations(input);
      const result = await runOperation(logFeedstockDelivery, context.ctx, input, options(context, dryRun, requestKey));
      return { ...result, body: feedstockCreateBody(result, dryRun) };
    },
    summarize(body, dryRun) {
      const data = (body as z.infer<typeof feedstockCreateEnvelopeSchema>).data;
      const codes = data.map((row) => row.code).join(", ");
      return dryRun ? `Dry run: would log feedstock ${codes} (provisional code).`
        : `Logged feedstock ${codes} into ${data.length} ${data.length === 1 ? "bin" : "bins"}.`;
    },
  },
  {
    kind: "write", name: updateFeedstock.id, scope: "feedstocks:write", input: updateInput, output: itemOutput,
    annotations: { ...annotations, destructiveHint: true },
    description: `Update a feedstock by UUID and adjust its bin stock and transport details. ${versionGuidance} ${writeGuidance}`,
    execute: (context, raw) => mutate(context, raw, "update"),
    summarize(body, dryRun) {
      const data = body.data as z.infer<typeof feedstockRepresentationSchema>;
      return dryRun ? `Dry run: would update feedstock ${data.code} to version ${data.version}.`
        : `Updated feedstock ${data.code} to version ${data.version}.`;
    },
  },
  {
    kind: "write", name: deleteFeedstock.id, scope: "feedstocks:delete", input: deleteInput, output: deleteOutput,
    annotations: { ...annotations, destructiveHint: true },
    description: `Delete a feedstock by UUID and remove its bin stock and transport details. Linked use may block deletion. Returns deleted id and code after saving, or data on a dry run. ${versionGuidance} ${writeGuidance}`,
    execute: (context, raw) => mutate(context, raw, "delete"),
    summarize(body, dryRun) {
      const data = body as z.infer<typeof deleteOutput>;
      const code = "deleted" in data ? data.deleted.code : (data.data as z.infer<typeof feedstockRepresentationSchema>).code;
      return dryRun ? `Dry run: would delete feedstock ${code}.` : `Deleted feedstock ${code}.`;
    },
  },
];

async function mutate(context: ApiRouteContext, raw: unknown, kind: "update" | "delete") {
  const contract = kind === "update" ? updateContract : deleteContract;
  const { input, dryRun, requestKey } = parseControls(raw, contract);
  // Decode the same operation schema REST uses before constructing its fingerprint.
  const parsed = (kind === "update" ? updateFeedstock.input : deleteFeedstock.input).safeParse(input);
  if (!parsed.success) throw validationFailed(parsed.error);
  const { feedstockId, expectedVersion } = parsed.data;
  const runOptions = options(context, dryRun, requestKey, feedstockId, expectedVersion);
  return withCurrentOnStale(context.ctx, feedstockId, async () => {
    if (kind === "update") {
      const operation = representationCheckedUpdate(feedstockId, FEEDSTOCK_REPRESENTATION_REVISION);
      const result = await runOperation(operation, context.ctx, input, runOptions);
      return { ...result, body: { data: representFeedstock(result.data), ...(dryRun ? { stockEffects: result.stockEffects } : {}) } };
    }
    const operation = representationCheckedDelete(feedstockId, FEEDSTOCK_REPRESENTATION_REVISION);
    const result = await runOperation(operation, context.ctx, input, runOptions);
    const row = result.data;
    return { ...result, body: dryRun ? { data: representFeedstock(row), stockEffects: result.stockEffects } : { deleted: { id: row.id, code: row.code } } };
  });
}
