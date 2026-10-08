import { z } from "zod";

const conflictRefSchema = z.object({
  entity: z.string().describe("Conflicting resource kind, plain text."),
  id: z.string().describe("Conflicting resource identifier, opaque string."),
  code: z.string().describe("Operator-readable conflict label, plain text."),
});

/** Wire shape emitted by problemResponse; open metadata carries safe domain limits. */
export const problemSchema = z.object({
  type: z.string().describe("Problem type URI, urn:noma:problem:<code>."),
  title: z.string().describe("Short HTTP status title, plain text."),
  status: z.number().int().describe("HTTP response status code."),
  detail: z.string().describe("Actionable plain-text detail; server failures are sanitized."),
  instance: z.string().describe("Request path, URI reference."),
  code: z.string().describe("Stable machine-readable problem code."),
  retryable: z.boolean().describe("Whether retrying may succeed; retain the same idempotency key."),
  errors: z.array(z.object({
    pointer: z.string().describe("RFC 6901 JSON Pointer to the invalid input; empty string denotes the root."),
    code: z.string().describe("Stable field error code."),
    detail: z.string().describe("Field correction guidance, plain text."),
    meta: z.record(z.string(), z.unknown()).optional().describe("Non-sensitive constraint metadata, such as maximum or unit; never rejected values."),
  })).describe("Input issues; empty for server failures."),
  conflict: conflictRefSchema.optional().describe("Visible record that blocks the write."),
  blockers: z.array(conflictRefSchema).optional().describe("Further visible blocking records, in display order."),
  current: z.unknown().optional().describe("Current resource representation after a failed version precondition."),
});
