import { beforeEach, expect, it, vi } from "vitest";
import { createOrderFn } from "./orders";
import { createCustomerWithLocationsFn } from "./customers";
import { createSupplierWithLocationsFn } from "./suppliers";
import { createProductionRunFn } from "./production-runs";
import { createCustomerWithLocationsSchema } from "@/schemas/customers";
import { createSupplierWithLocationsSchema } from "@/schemas/suppliers";
import { createProductionRunSchema } from "@/schemas/production-runs";
import type { CreateIntentOptions } from "@/schemas/create-intent";

const { auth, run } = vi.hoisted(() => ({ auth: vi.fn(), run: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ requireOrgContext: auth }));
vi.mock("@/lib/operations/runner", () => ({ runOperationInProcess: run }));
vi.mock("@/lib/operations/orders", () => ({ recordOrder: { id: "record_order" } }));
vi.mock("@/data-access/orders", () => ({}));
vi.mock("@/data-access/customers", () => ({}));
vi.mock("@/data-access/suppliers", () => ({}));
vi.mock("@/data-access/production-runs", () => ({}));
vi.mock("@/lib/operations/customers", () => ({ createCustomer: { id: "create_customer" } }));
vi.mock("@/lib/operations/suppliers", () => ({ createSupplier: { id: "create_supplier" } }));
vi.mock("@/lib/operations/production-runs", () => ({ startProductionRun: { id: "start_production_run" } }));
vi.mock("@/lib/operations/customer-locations", () => ({}));
vi.mock("@/lib/operations/supplier-locations", () => ({}));
vi.mock("@/lib/operations/cascade-preview", () => ({}));
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

const customerInput = createCustomerWithLocationsSchema.parse({
  customer: { name: "Customer intent test" },
  locations: [{ name: "Farm", country: "TZ", gpsLatitude: -6, gpsLongitude: 35 }],
});
const supplierInput = createSupplierWithLocationsSchema.parse({
  supplier: { name: "Supplier intent test" },
  locations: [{ name: "Source", country: "TZ", gpsLatitude: -6, gpsLongitude: 35 }],
});
const productionRunInput = createProductionRunSchema.parse({
  facilityId: ID, reactorId: ID, startDate: "2026-01-01", startTime: new Date("2026-01-01T08:00:00Z"),
});
const createPaths = [
  { operationId: "create_customer", create: (options?: CreateIntentOptions) => createCustomerWithLocationsFn(customerInput, options) },
  { operationId: "create_supplier", create: (options?: CreateIntentOptions) => createSupplierWithLocationsFn(supplierInput, options) },
  { operationId: "start_production_run", create: (options?: CreateIntentOptions) => createProductionRunFn(productionRunInput, options) },
];

it.each(createPaths)("forwards the same separate intent on retries of $operationId and supports keyless calls", async ({ operationId, create }) => {
  run.mockResolvedValue({ id: ID, supplier: { id: ID } });
  const first = await create({ intentKey: ID });
  expect(first.success).toBe(true);
  expect(await create({ intentKey: ID })).toEqual(first);
  expect(run).toHaveBeenNthCalledWith(1, { id: operationId }, ctx, expect.not.objectContaining({ intentKey: ID }), { intentKey: ID });
  expect(run.mock.calls[1]).toEqual(run.mock.calls[0]);
  expect(await create()).toMatchObject({ success: true });
  expect(run.mock.calls[2][3]).toBeUndefined();
});

it.each(createPaths)("rejects malformed intent before $operationId writes", async ({ create }) => {
  expect(await create({ intentKey: "not-a-uuid" })).toMatchObject({ success: false, code: "validation_failed" });
  expect(run).not.toHaveBeenCalled();
});
