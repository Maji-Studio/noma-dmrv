import { describe, expect, expectTypeOf, it } from "vitest";
import { toApiAuditRow } from "./api-activity";

describe("toApiAuditRow", () => {
  it("narrows operationId while preserving document audit fields", () => {
    const row: { operationId: string | null; transport: string; id: string; entityId: string } = {
      operationId: "confirm_document_upload", transport: "mcp", id: "audit-id", entityId: "document-id",
    };

    const audit = toApiAuditRow(row);

    expectTypeOf(audit.operationId).toEqualTypeOf<string>();
    expectTypeOf(audit.entityId).toEqualTypeOf<string>();
    expect(audit).toEqual(row);
  });

  it("rejects rows that violate the API audit predicate", () => {
    expect(() => toApiAuditRow({ operationId: null, transport: "mcp" }))
      .toThrow("API audit row is missing operationId.");
  });
});
