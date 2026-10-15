import { expect, it } from "vitest";
import { documentFromConfirmOutcome, mapConfirmOutcome } from "./confirm-outcome";
import type { DocumentRepresentation } from "@/lib/representations/documents";
import type { DocumentRow } from "@/data-access/documents";
const document = { id: "test" } as DocumentRow;
it("maps committed outcomes without confusing a refused transition with success", () => {
  expect(documentFromConfirmOutcome({ kind: "uploaded", document })).toBe(document);
  expect(() => documentFromConfirmOutcome({ kind: "gone" })).toThrow(expect.objectContaining({ code: "not_found" }));
  expect(() => documentFromConfirmOutcome({ kind: "refused", document, reason: "checksum", pointer: "/sha256", message: "Checksum mismatch" })).toThrow(expect.objectContaining({ code: "validation_failed", issues: [expect.objectContaining({ path: ["sha256"] })] }));
  expect(() => documentFromConfirmOutcome({ kind: "refused", document, reason: "certification_locked", pointer: "/labSampleId", message: "Locked" })).toThrow(expect.objectContaining({ code: "certification_locked" }));
});

it("maps API outcomes identically for REST and MCP after commit", () => {
  const representation = { id: "document", version: 2 } as DocumentRepresentation;
  expect(mapConfirmOutcome({ kind: "uploaded", document: representation })).toEqual({ status: 200, data: representation });
  expect(mapConfirmOutcome({ kind: "gone" })).toMatchObject({ status: 404, error: { code: "not_found", issues: [{ path: ["documentId"] }] } });
  expect(mapConfirmOutcome({ kind: "refused", document: representation, reason: "checksum", pointer: "/sha256", message: "Checksum mismatch" })).toMatchObject({ status: 422, error: { code: "validation_failed", issues: [{ path: ["sha256"], code: "checksum", message: "Checksum mismatch" }] } });
  expect(mapConfirmOutcome({ kind: "refused", document: representation, reason: "certification_locked", pointer: "/ownerId", message: "Locked" })).toMatchObject({ status: 409, error: { code: "certification_locked", issues: [{ path: ["ownerId"] }] } });
  expect(mapConfirmOutcome({ kind: "failed", reason: "checksum", message: "Checksum mismatch" })).toMatchObject({ status: 409, error: { code: "conflict", issues: [{ path: ["documentId"], code: "checksum", message: "Checksum mismatch" }] } });
});
