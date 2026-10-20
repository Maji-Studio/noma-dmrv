import { beforeEach, expect, it, vi } from "vitest";
import { createOrderFn } from "./orders";

const { auth, run } = vi.hoisted(() => ({ auth: vi.fn(), run: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ requireOrgContext: auth }));
vi.mock("@/lib/operations/runner", () => ({ runOperationInProcess: run }));
vi.mock("@/lib/operations/orders", () => ({ recordOrder: { id: "record_order" } }));
vi.mock("@/data-access/orders", () => ({}));
vi.mock("@/data-access/utils", () => ({}));
vi.mock("@/lib/log", () => ({ logger: { error: vi.fn() }, sanitizeErrorMessage: vi.fn() }));

const ID = "11111111-1111-4111-8111-111111111111";
const ctx = { userId: ID, organizationId: ID, orgRole: "owner", isPlatformAdmin: false };
const input = { facilityId: ID, customerId: ID, customerLocationId: ID, formulationId: ID, orderDate: new Date("2026-09-12"), quantityKg: 100, packaging: "loose" as const };
beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue(ctx);
  run.mockResolvedValue({ id: ID });
});

it("validates and forwards the optional create intent separately from order values", async () => {
  expect(await createOrderFn(input, { intentKey: ID })).toMatchObject({ success: true });
  expect(run).toHaveBeenCalledWith({ id: "record_order" }, ctx, expect.not.objectContaining({ intentKey: ID }), { intentKey: ID });
  expect(await createOrderFn(input)).toMatchObject({ success: true });
  expect(run.mock.calls[1][3]).toBeUndefined();
});

it("rejects a malformed intent before running the write", async () => {
  expect(await createOrderFn(input, { intentKey: "not-a-uuid" })).toMatchObject({ success: false, code: "validation_failed" });
  expect(run).not.toHaveBeenCalled();
});
