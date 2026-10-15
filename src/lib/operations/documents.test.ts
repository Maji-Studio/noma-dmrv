import { expect, it } from "vitest";
import { deleteDocumentApp, reclassifyApplicationEvidenceApp, setDocumentVisibilityApp } from "./documents";
const documentId = "12345678-1234-4234-8234-123456789abc";
it.each([
  [deleteDocumentApp.input, { documentId }],
  [setDocumentVisibilityApp.input, { documentId, visibility: "private" }],
  [reclassifyApplicationEvidenceApp.input, { documentId, applicationEvidenceRole: "spreading" }],
] as const)("requires a positive expected version on app edits", (schema, input) => {
  expect(schema.safeParse(input).success).toBe(false);
  expect(schema.safeParse({ ...input, expectedVersion: 0 }).success).toBe(false);
  expect(schema.safeParse({ ...input, expectedVersion: 2 }).success).toBe(true);
});
