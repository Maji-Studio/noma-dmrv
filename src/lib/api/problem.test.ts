import { expect, it } from "vitest";
import { actionFailureResponse, apiDenialResponse, problemResponse } from "./problem";
import type { DomainErrorCode } from "@/lib/domain-errors";
import { problemSchema } from "./problem-schema";
import { conflictCode } from "@/lib/conflict-ref";
import type { ApiContextDenial } from "@/lib/auth/api-context";

// Independent expectations from the REST plan, section 4 (Errors).
const expectedActionStatuses = {
  validation_failed: 422,
  not_found: 404,
  stale_version: 412,
  concurrent_write_retry: 409,
  conflict: 409,
  certification_locked: 409,
  insufficient_stock: 409,
  stock_basis_changed: 409,
  forbidden: 403,
  reference_not_found: 422,
  reference_ambiguous: 422,
  registry_not_configured: 409,
  registry_read_refused: 422,
  registry_unavailable: 503,
  storage_not_configured: 409,
  storage_unavailable: 503,
  report_verification_failed: 409,
  deadline_exceeded: 500,
  outcome_unknown: 500,
  idempotency_in_progress: 409,
  idempotency_key_reused: 422,
  key_already_used: 409,
  replay_unavailable: 409,
} satisfies Record<DomainErrorCode, number>;

it.each(Object.entries(expectedActionStatuses))("maps %s to %s", async (code, status) => {
  const response = actionFailureResponse({
    success: false,
    code: code as DomainErrorCode,
    error: "Safe detail",
  }, "/api/v1/me", "request-id");
  expect(response.status).toBe(status);
  expect(response.headers.get("content-type")).toBe("application/problem+json");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-request-id")).toBe("request-id");
});

const expectedDenialStatuses = {
  credential_missing: 401,
  credential_malformed: 401,
  credential_ambiguous: 401,
  credential_header_unsupported: 401,
  cookie_session_unsupported: 401,
  credential_invalid: 401,
  credential_expired: 401,
  credential_disabled: 401,
  credential_revoked: 401,
  credential_owner_removed: 401,
  credential_owner_unverified: 401,
  api_access_disabled: 403,
  missing_scope: 403,
  insufficient_role: 403,
} satisfies Record<ApiContextDenial, number>;

it.each(Object.entries(expectedDenialStatuses))("maps denial %s to %s", (denial, status) => {
  const response = apiDenialResponse(denial as ApiContextDenial, "/api/v1/me", "request-id");
  expect(response.status).toBe(status);
  expect(response.headers.get("www-authenticate")).toBe(status === 401 ? "Bearer" : null);
});

it("escapes JSON pointers and preserves safe validation metadata", async () => {
  const response = actionFailureResponse({
    success: false,
    code: "validation_failed",
    error: "Invalid",
    issues: [{
      path: ["a/b~", 0],
      code: "invalid",
      message: "Fix field",
      meta: { max: 1 },
    }],
  }, "/api/v1/items", "id");
  expect((await response.json()).errors).toEqual([{
    pointer: "/a~1b~0/0",
    code: "invalid",
    detail: "Fix field",
    meta: { max: 1 },
  }]);
});

it("sanitizes all 500 details, issues and prose-only action failures", async () => {
  const response = problemResponse({
    status: 500,
    code: "internal_error",
    detail: "SECRET",
    instance: "/api/v1/me",
    requestId: "id",
    errors: [{
      pointer: "",
      code: "internal",
      detail: "SECRET",
    }],
  });
  expect(await response.text()).not.toContain("SECRET");
  expect(await actionFailureResponse({
    success: false,
    error: "SECRET",
  }, "/api/v1/me", "id").text()).not.toContain("SECRET");
});

it("maps an unexpected action failure without a code to 500", () => {
  const response = actionFailureResponse({
    success: false,
    error: "Unexpected failure",
  }, "/api/v1/me", "request-id");
  expect(response.status).toBe(500);
});

it.each([[429, "Too many requests"], [503, "Service unavailable"]] as const)("titles status %s", async (status, title) => {
  const response = problemResponse({ status, code: "test", detail: "", instance: "/api/v1/me", requestId: "id", retryable: true });
  expect(await response.json()).toMatchObject({ title, status, retryable: true });
});

it.each([["supplierId"], ["allocations", 0, "storageLocationId"]])("preserves not-found reference pointers: %j", async (...path) => {
  const response = actionFailureResponse({
    success: false, code: "not_found", error: "Reference not found",
    issues: [{ path, code: "not_found", message: "Reference not found" }],
  }, "/api/v1/feedstocks", "request-id");
  expect(response.status).toBe(404);
  expect((await response.json()).errors).toEqual([{
    pointer: `/${path.join("/")}`, code: "not_found", detail: "Reference not found",
  }]);
});


it("keeps the documented problem shape aligned with optional domain extensions", async () => {
  const ref = { entity: "feedstock", id: "resource-id", code: conflictCode("FS-26-0231") };
  const response = problemResponse({
    status: 412, code: "stale_version", detail: "Read the current feedstock.",
    instance: "/api/v1/feedstocks/resource-id", requestId: "request-id",
    errors: [{ pointer: "/massWetKg", code: "too_big", detail: "Reduce wet mass.", meta: { maximum: 4200, unit: "kg" } }],
    conflict: ref, blockers: [ref], current: { id: "resource-id", version: 2 },
  });
  const body = await response.json();
  expect(problemSchema.strict().parse(body)).toEqual(body);
  expect(body).toMatchObject({ conflict: ref, blockers: [ref], current: { version: 2 } });
});

it("exposes exhausted concurrent writes as a retryable 409", async () => {
  const response = actionFailureResponse({ success: false, code: "concurrent_write_retry", error: "Retry shortly." }, "/api/v1/production-runs", "request");
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: "concurrent_write_retry", retryable: true });
});

it("exposes unavailable registry reads as a retryable 503", async () => {
  const response = actionFailureResponse({ success: false, code: "registry_unavailable", error: "Retry shortly." }, "/api/v1/me", "request");
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: "registry_unavailable", retryable: true });
});

it("renders a changed stock basis as a non-retryable 409 with the bin and the fresh preview", async () => {
  const conflict = { entity: "storageLocation", id: "bin-id", code: conflictCode("BC-01") };
  const preview = { basisFingerprint: "fresh-basis", stockEffects: [{
    storageLocationId: "00000000-0000-4000-8000-000000000001", storageLocationCode: "BC-01", stockKind: "biochar_bin" as const,
    before: { wetKg: null, dryKg: 120 }, after: { wetKg: null, dryKg: 100 }, delta: { wetKg: null, dryKg: -20 },
  }] };
  const response = actionFailureResponse({
    success: false, code: "stock_basis_changed", error: "Stock changed since this preview. Refresh the preview and try again.", conflict, preview,
  }, "/api/v1/biochar-products", "request-id");
  expect(response.status).toBe(409);
  const body = await response.json();
  expect(problemSchema.strict().parse(body)).toEqual(body);
  expect(body).toMatchObject({ type: "urn:noma:problem:stock_basis_changed", code: "stock_basis_changed", retryable: false, conflict, preview });
});

it("omits the preview when none was computed and never shows it on a server failure", async () => {
  const preview = { basisFingerprint: "fresh-basis", stockEffects: [] };
  const withoutPreview = await actionFailureResponse({ success: false, code: "stock_basis_changed", error: "Stock changed." }, "/api/v1/biochar-products", "id").json();
  expect(withoutPreview).not.toHaveProperty("preview");
  const internal = await problemResponse({ status: 500, code: "internal_error", detail: "x", instance: "/api/v1/biochar-products", requestId: "id", preview }).json();
  expect(internal).not.toHaveProperty("preview");
});

it.each([
  ["storage_unavailable", 503, true],
  ["storage_not_configured", 409, false],
  ["report_verification_failed", 409, false],
] as const)("maps %s retryability", async (code, status, retryable) => {
  const response = actionFailureResponse({ success: false, code, error: "Safe detail" }, "/api/v1/me", "request");
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ code, retryable });
});
