import { beforeEach, describe, expect, it, vi } from "vitest";
import { conflictCode } from "@/lib/conflict-ref";
import { ActionConflictError } from "@/lib/errors";
import type { OrgContext } from "@/lib/auth/server";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), create: vi.fn(), autoCode: vi.fn(), log: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ requireOrgContext: mocks.auth }));
vi.mock("@/lib/log", () => ({ logger: { error: mocks.log }, sanitizeErrorMessage: () => "sanitized" }));
vi.mock("@/data-access/biochar-products", () => ({ createBiocharProduct: mocks.create }));
vi.mock("@/data-access/deliveries", () => ({ createDelivery: mocks.create }));
vi.mock("@/data-access/delivery-stats", () => ({}));
vi.mock("@/data-access/utils", () => ({}));
vi.mock("@/db/schema", () => ({ biocharProducts: { code: "code" }, deliveries: { code: "code" } }));
vi.mock("@/data-access/code-generator", () => ({ withAutoCode: mocks.autoCode, CODE_CONFLICT_MESSAGES: { biocharProduct: "Product code conflict", delivery: "Delivery code conflict" } }));
import { createBiocharProductFn } from "./biochar-products";
import { createDeliveryFn } from "./deliveries";

const id = "00000000-0000-4000-8000-000000000001";
const ctx: OrgContext = { userId: "user", organizationId: "org", orgRole: "admin", isPlatformAdmin: false };
const common = { facilityId: id, storageLocationId: id, idempotencyKey: "stable-key", basisFingerprint: "stale-basis", moistureContentPercent: 20 };
const product = { ...common, formulationId: id, placedAt: "2026-09-15T12:00:00.000Z", sourceBiocharStorageLocationId: id, status: "testing" as const, massKg: 100, waterAddedKg: 0, densityKgM3: null };
const delivery = { ...common, code: "DL-001", orderId: id, deliveryDate: new Date("2026-09-15T00:00:00Z"), status: "delivered" as const, deliveredWetMassKg: 100 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue(ctx);
  mocks.create.mockReset();
  mocks.autoCode.mockImplementation(async (_ctx, _prefix, _table, _column, code, create) => create(code ?? "BP-001"));
});

for (const action of [
  { name: "product", call: () => createBiocharProductFn(product), invalid: () => createBiocharProductFn({ ...product, formulationId: "invalid" }), prefix: "BP", code: undefined, fallback: "Biochar product was not created. Try again.", log: "biochar product action failed", op: "biochar-product:create" },
  { name: "delivery", call: () => createDeliveryFn(delivery), invalid: () => createDeliveryFn({ ...delivery, storageLocationId: "invalid" }), prefix: "DL", code: "DL-001", fallback: "Delivery was not created. Try again.", log: "delivery action failed", op: "delivery:create" },
]) describe(`${action.name} posting boundary`, () => {
  it("preserves typed stale-bin conflicts", async () => {
    const conflict = { entity: "storageLocation", id, code: conflictCode("BIN-001") };
    mocks.create.mockRejectedValue(new ActionConflictError("Stock changed. Review the refreshed preview.", conflict));
    expect(await action.call()).toEqual({ success: false, error: "Stock changed. Review the refreshed preview.", conflict });
    expect(mocks.log).not.toHaveBeenCalled();
  });
  it("preserves success, authenticated context and auto-code delegation", async () => {
    const saved = { id, code: "SAVED" };
    mocks.create.mockResolvedValue(saved);
    expect(await action.call()).toEqual({ success: true, data: saved });
    expect(mocks.create).toHaveBeenCalledWith(ctx, expect.objectContaining(common));
    expect(mocks.autoCode).toHaveBeenCalledWith(ctx, action.prefix, expect.anything(), "code", action.code, expect.any(Function), expect.any(String));
  });
  it("validates before posting", async () => {
    expect(await action.invalid()).toMatchObject({ success: false });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("requires organization authentication", async () => {
    mocks.auth.mockRejectedValue(new Error("No session"));
    expect(await action.call()).toMatchObject({ success: false });
    expect(mocks.autoCode).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("preserves safe fallback and log context", async () => {
    mocks.create.mockRejectedValue(new Error("internal failure"));
    expect(await action.call()).toEqual({ success: false, error: action.fallback });
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ op: action.op }), action.log);
  });
});

describe("delivery split-bin sources", () => {
  const p1 = "00000000-0000-4000-8000-000000000002";
  const p2 = "00000000-0000-4000-8000-000000000003";
  // A split load carries a reading per sub-bin instead of one moisture.
  const splitDelivery = { ...delivery, moistureContentPercent: undefined };

  it("hands the ordered sub-bin readings to the writer in place of one moisture", async () => {
    const sources = [{ layerId: p2, moisturePercent: 20 }, { layerId: p1, moisturePercent: 25 }];
    mocks.create.mockResolvedValue({ id, code: "DL-001" });
    expect(await createDeliveryFn({ ...splitDelivery, sources })).toMatchObject({ success: true });
    expect(mocks.create).toHaveBeenCalledWith(ctx, expect.objectContaining({ sources, moistureContentPercent: undefined }));
  });
  it("refuses a sub-bin listed twice before posting", async () => {
    const sources = [{ layerId: p1, moisturePercent: 20 }, { layerId: p1, moisturePercent: 25 }];
    expect(await createDeliveryFn({ ...splitDelivery, sources })).toMatchObject({ success: false });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe("product creation split-bin sources", () => {
  const r1 = "00000000-0000-4000-8000-000000000004";
  const r2 = "00000000-0000-4000-8000-000000000005";
  // A split biochar bin carries a reading per sub-bin instead of one biochar moisture.
  const splitProduct = { ...product, moistureContentPercent: undefined };

  it("hands the ordered run readings to the writer in place of one moisture", async () => {
    const sources = [{ layerId: r2, moisturePercent: 20 }, { layerId: r1, moisturePercent: 10 }];
    mocks.create.mockResolvedValue({ id, code: "BP-001" });
    expect(await createBiocharProductFn({ ...splitProduct, sources })).toMatchObject({ success: true });
    expect(mocks.create).toHaveBeenCalledWith(ctx, expect.objectContaining({ sources, moistureContentPercent: null }));
  });
  it("refuses a run listed twice, and a draw with neither moisture nor readings, before posting", async () => {
    expect(await createBiocharProductFn({ ...splitProduct, sources: [{ layerId: r1, moisturePercent: 20 }, { layerId: r1, moisturePercent: 25 }] })).toMatchObject({ success: false });
    expect(await createBiocharProductFn(splitProduct)).toMatchObject({ success: false });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
