import { expect, it } from "vitest";
import { documentFromConfirmOutcome } from "./confirm-outcome";
import type { DocumentRow } from "@/data-access/documents";
const document = { id: "test" } as DocumentRow;
it("maps committed outcomes without confusing a refused transition with success", () => {
  expect(documentFromConfirmOutcome({ kind: "uploaded", document })).toBe(document);
  expect(() => documentFromConfirmOutcome({ kind: "gone" })).toThrow(expect.objectContaining({ code: "not_found" }));
  expect(() => documentFromConfirmOutcome({ kind: "refused", document, reason: "checksum", pointer: "/sha256", message: "Checksum mismatch" })).toThrow(expect.objectContaining({ code: "validation_failed", issues: [expect.objectContaining({ path: ["sha256"] })] }));
  expect(() => documentFromConfirmOutcome({ kind: "refused", document, reason: "certification_locked", pointer: "/labSampleId", message: "Locked" })).toThrow(expect.objectContaining({ code: "certification_locked" }));
});
