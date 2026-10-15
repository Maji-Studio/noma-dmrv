import { z } from "zod";
import { documentRepresentationSchema } from "./documents";
import { itemEnvelopeSchema } from "./envelopes";

export const documentUploadEnvelopeSchema = itemEnvelopeSchema(documentRepresentationSchema).extend({
  upload: z.object({
    url: z.url().describe("Short-lived upload URL. PUT without the API key."),
    method: z.literal("PUT").describe("HTTP method for the file transfer."),
    headers: z.record(z.string(), z.string()).describe("Headers required on the PUT, including Content-Type."),
    expiresAt: z.iso.datetime().describe("UTC instant when the upload capability expires."),
  }).nullable().describe("Fresh upload capability while pending, or null when unavailable."),
  warnings: z.array(z.string()).optional().describe("Plain-text guidance explaining an unavailable upload capability."),
});
