import type { z } from "zod";
import { applicationBoundaryRepresentationSchema } from "@/lib/representations/applications";
import { deliveryApplicationBalanceRepresentationSchema } from "@/lib/representations/delivery-application-balance";
import { itemEnvelopeSchema } from "@/lib/representations/envelopes";
import { readDescriptions } from "@/lib/operations/read-descriptions";
import type { JsonSchema } from "@/lib/operations/json-schema";
import { privateOperation, type Paths } from "./operation-kit";
import { etagHeader, jsonResponse, problemResponses, targetParameter } from "./transport";
import { BODY_HASH_ETAG_PATTERN } from "../etag";

const READ_ERRORS = [400, 401, 403, 404, 429, 500];

export function addApplicationReadPaths(paths: Paths, publishOutput: (schema: z.ZodType) => JsonSchema) {
  paths["/applications/{idOrCode}/boundary"] = { get: privateOperation("get_application_boundary", "applications:read", readDescriptions.applicationBoundary,
    { ...problemResponses(READ_ERRORS), "200": jsonResponse("Stored boundary and summary.", publishOutput(itemEnvelopeSchema(applicationBoundaryRepresentationSchema)), etagHeader) }, [targetParameter()]) };
  paths["/deliveries/{idOrCode}/application-balance"] = { get: privateOperation("get_delivery_application_balance", "deliveries:read", readDescriptions.deliveryApplicationBalance,
    { ...problemResponses(READ_ERRORS), "200": jsonResponse("Delivery application balance snapshot.", publishOutput(itemEnvelopeSchema(deliveryApplicationBalanceRepresentationSchema)), {
      ETag: { description: "Hash of every published balance field, including site defaults, and the representation revision.", schema: { type: "string", pattern: BODY_HASH_ETAG_PATTERN.source } },
      "Cache-Control": { description: "Private response; do not store the balance.", schema: { type: "string", enum: ["private, no-store"], description: "Private response; do not store the balance." } },
    }) }, [targetParameter()]) };
}
