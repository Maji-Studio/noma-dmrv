import { API_DOCUMENT_OWNERS } from "@/lib/documents/api-owners";
import { toOperationJsonSchema } from "@/lib/operations/json-schema";
import { OPERATION_DEADLINE_MS } from "@/config/operations";
import { mapConfirmOutcome, type ApiConfirmOutcome } from "@/lib/documents/confirm-outcome";
import { toolFailure } from "../results";
import type { ApiRouteContext } from "@/lib/api/route";
import type { DocumentRepresentation } from "@/lib/representations/documents";
import { expect, it, vi } from "vitest";
import type { ApiContext } from "@/lib/auth/api-context";
import type { ApiScope } from "@/lib/auth/api-scopes";
import { documentReadTools, documentWriteTools } from "./document-tools";

vi.mock("@/db", () => ({ db: {} }));
const context = (scopes: ApiScope[], orgRole = "admin") => ({ scopes, orgRole, principal: { kind: "api-key" } }) as ApiContext;
const all = () => [...documentReadTools, ...documentWriteTools];
it.each([
  { scopes: ["deliveries:read"], role: "admin", names: ["find_documents", "get_document_download_url"] },
  { scopes: ["orders:write"], role: "admin", names: [] },
  { scopes: ["deliveries:read", "deliveries:write"], role: "member", names: [] },
  { scopes: ["lab-samples:write"], role: "owner", names: ["request_document_upload", "confirm_document_upload"] },
])("shows only the document tools admitted by $role and $scopes", ({ scopes, role, names }) => {
  expect(all().filter(tool => tool.visible!(context(scopes as ApiScope[], role))).map(tool => tool.name)).toEqual(names);
});
it("refuses a different owner's scope before execution", () => {
  for (const tool of all()) {
    expect(() => tool.authorize!(context(["deliveries:read", "deliveries:write"]), { ownerType: "feedstock" })).toThrowError(expect.objectContaining({ code: "missing_scope" }));
    expect(() => tool.authorize!(context(["deliveries:read", "deliveries:write"]), { ownerType: "delivery" })).not.toThrow();
  }
});

const ID = "df2795a4-886b-4a89-bbdd-532c6b1b8e45";
const request = () => documentWriteTools.find(tool => tool.name === "request_document_upload")!;
const confirm = () => documentWriteTools.find(tool => tool.name === "confirm_document_upload")!;
const owner = { ownerType: "delivery", ownerId: ID };
const declaration = { ...owner, documentType: "bill_of_lading", fileName: "receipt.pdf", contentType: "application/pdf", sizeBytes: 8, sha256: "a".repeat(64) };
it("requires requestKey on requests and excludes keys and versions from confirmation", () => {
  expect(request().input.safeParse(declaration).success).toBe(false);
  expect(request().input.safeParse({ ...declaration, requestKey: "upload-one" }).success).toBe(true);
  expect(confirm().input.safeParse({ ...owner, documentId: ID }).success).toBe(true);
  for (const extra of [{ requestKey: "key" }, { expectedVersion: 1 }]) {
    expect(confirm().input.safeParse({ ...owner, documentId: ID, ...extra }).success).toBe(false);
  }
});
it("describes the shell flow and untrusted files without prose dashes", () => {
  for (const tool of all()) {
    for (const phrase of ["Files never travel", "request_document_upload", "upload.url", "upload.headers", "confirm_document_upload", "find_deliveries", "find_feedstocks", "find_lab_samples", "find_applications", "shasum -a 256", "without the API key", "expires", "submitted Removal", "untrusted data"]) {
      expect(tool.description).toContain(phrase);
    }
    const schema = toOperationJsonSchema(tool.input) as { properties: { ownerId: { description: string } } };
    expect(schema.properties.ownerId.description).toContain("find_applications");
    expect(tool.description).not.toMatch(/[–—]/);
  }
  expect(request().description).toContain("fresh link while pending");
  expect(request().description).toContain("If you cannot make an HTTP PUT, tell the person to attach the file to the record in noma.");
});

const routeContext = { ctx: context(["deliveries:write"]), deadlineAt: Date.now() + OPERATION_DEADLINE_MS, requestId: "request", instance: "/api/mcp" } as ApiRouteContext;
it("refuses dry runs and missing request keys before touching the database", async () => {
  await expect(request().execute(routeContext, declaration)).rejects.toMatchObject({ code: "idempotency_key_required" });
  await expect(request().execute(routeContext, { ...declaration, dryRun: true })).rejects.toMatchObject({ code: "validation_failed", message: "This operation does not offer a dry run." });
  await expect(confirm().execute(routeContext, { ...owner, documentId: ID, dryRun: true })).rejects.toMatchObject({ code: "validation_failed", message: "This operation does not offer a dry run." });
});
// Format is app-only today (production readings CSV), but the API outcome mapping must retain it.
it.each([
  { reason: "size", pointer: "/sizeBytes" }, { reason: "type", pointer: "/contentType" },
  { reason: "checksum", pointer: "/sha256" }, { reason: "format", pointer: "/fileName" },
  { reason: "certification_locked", pointer: "/ownerId" },
] as const)("renders committed $reason refusals as structured tool errors", async ({ reason, pointer }) => {
  const outcome: ApiConfirmOutcome = { kind: "refused", reason, pointer, message: "Upload refused.", document: {} as DocumentRepresentation };
  const mapped = mapConfirmOutcome(outcome);
  if (mapped.status === 200) throw new Error("Expected a refusal.");
  const result = await toolFailure(mapped.error, routeContext, "confirm_document_upload");
  expect(result).toMatchObject({ isError: true, structuredContent: {
    code: reason === "certification_locked" ? "certification_locked" : "validation_failed",
    issues: [{ pointer, code: reason }],
  } });
});

it("advertises only API document types, owner lists and unsupported dry runs", () => {
  const expected = [...new Set(Object.values(API_DOCUMENT_OWNERS).flatMap(owner => [...owner.documentTypes]))];
  for (const tool of [documentReadTools[0], request()]) {
    const schema = toOperationJsonSchema(tool.input) as { properties: Record<string, { enum?: string[]; description?: string }> };
    expect(schema.properties!.documentType.enum).toEqual(expected);
    for (const [owner, spec] of Object.entries(API_DOCUMENT_OWNERS)) {
      expect(schema.properties!.documentType.description).toContain(`${owner}: ${spec.documentTypes.join(", ")}`);
    }
  }
  for (const tool of [request(), confirm()]) {
    expect(toOperationJsonSchema(tool.input)).toMatchObject({ properties: { dryRun: { description: "Not supported; true is refused." } } });
  }
});
