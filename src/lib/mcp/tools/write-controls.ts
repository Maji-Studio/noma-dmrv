import { z } from "zod";
import { API_IDEMPOTENCY_KEY_MAX_LENGTH, FEEDSTOCK_REPRESENTATION_REVISION } from "@/config/api-rest";
import type { ApiRouteContext } from "@/lib/api/route";
import { ApiHttpError } from "@/lib/api/http-error";
import { IDEMPOTENCY_KEY_PATTERN } from "@/lib/api/request-body";
import { representationEtag } from "@/lib/api/etag";
import { rejectUnknownFields } from "@/lib/api/unknown-fields";
import { remainingDeadlineMs } from "@/lib/api/feedstock-write-checks";
import { validationFailed } from "@/lib/operations/errors";
import type { JsonSchema } from "@/lib/operations/json-schema";
import { REQUEST_KEY_RULE } from "@/lib/operations/agent-guidance";

export const controls = z.object({
  dryRun: z.boolean().optional().default(false).describe("Preview without saving changes."),
  requestKey: z.string().min(1).max(API_IDEMPOTENCY_KEY_MAX_LENGTH).regex(IDEMPOTENCY_KEY_PATTERN)
    .optional().describe(REQUEST_KEY_RULE),
});
export function parseControls(raw: unknown, contract: JsonSchema) {
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

export function writeOptions(context: ApiRouteContext, dryRun: boolean, key?: string, target?: string, version?: number, revision = FEEDSTOCK_REPRESENTATION_REVISION) {
  return {
    deadlineMs: remainingDeadlineMs(context.deadlineAt), dryRun,
    audit: { requestId: context.requestId, credentialId: context.ctx.credentialId, transport: "mcp" as const },
    idempotency: key ? { credentialId: context.ctx.credentialId, key,
      ...(target ? { target, precondition: representationEtag(version!, revision) } : {}),
    } : undefined,
  };
}

