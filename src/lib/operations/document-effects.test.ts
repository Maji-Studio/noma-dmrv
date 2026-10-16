import { expect, it } from "vitest";
import { describeConfirmedDocument, describeDeletedDocument, describeRequestedDocument, describeUpdatedDocument } from "./document-effects";

const DOCUMENT_ID = "document-id";
const VERSION = 2;
const document = { id: DOCUMENT_ID, version: VERSION };

it("describes requests and metadata writes with metadata ready for captured fields", () => {
  const input = { documentId: DOCUMENT_ID, expectedVersion: VERSION - 1, fileName: "private.pdf", visibility: "public", description: undefined };
  expect(describeRequestedDocument(input, document)).toEqual({
    outcome: "created", entityType: "document", entityIds: [DOCUMENT_ID],
    versionBefore: null, versionAfter: VERSION, changedFields: [],
  });
  expect(describeUpdatedDocument(input, document)).toMatchObject({ outcome: "updated", versionBefore: VERSION - 1, changedFields: [] });
  expect(describeDeletedDocument(input)).toEqual({
    outcome: "deleted", entityType: "document", entityIds: [DOCUMENT_ID], versionBefore: VERSION - 1, versionAfter: null, changedFields: [],
  });
});

it("describes committed confirmations and refusals, excluding unchanged or missing uploads", () => {
  const uploaded = { kind: "uploaded" as const, document };
  expect(describeConfirmedDocument({}, uploaded)).toBeNull();
  expect(describeConfirmedDocument({}, { ...uploaded, transitioned: false })).toBeNull();
  expect(describeConfirmedDocument({}, { kind: "gone" })).toBeNull();
  expect(describeConfirmedDocument({}, { kind: "failed", reason: "size", message: "private" })).toBeNull();
  const effect = { outcome: "updated", entityType: "document", entityIds: [DOCUMENT_ID],
    versionBefore: VERSION - 1, versionAfter: VERSION, changedFields: [] };
  expect(describeConfirmedDocument({}, { ...uploaded, transitioned: true })).toEqual(effect);
  expect(describeConfirmedDocument({}, { kind: "refused", document, reason: "size", pointer: "/sizeBytes", message: "private" })).toEqual(effect);
});
