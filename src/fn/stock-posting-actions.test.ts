import { beforeEach, describe, expect, it, vi } from "vitest";
import { conflictCode } from "@/lib/conflict-ref";
import { DomainError } from "@/lib/domain-errors";
import { ActionConflictError } from "@/lib/errors";
import { deliveryActionFieldIssues, throwDeliveryActionError } from "@/lib/delivery-action-errors";
import type { OrgContext } from "@/lib/auth/server";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), autoCode: vi.fn(), log: vi.fn(), run: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ requireOrgContext: mocks.auth }));
vi.mock("@/lib/log", () => ({ logger: { error: mocks.log }, sanitizeErrorMessage: () => "sanitized" }));
vi.mock("@/data-access/biochar-products", () => ({}));
// Products run `make_biochar_product` in process; the runner is mocked and the
// operation itself runs against the database in tests/operation-biochar-products.test.ts.
vi.mock("@/lib/operations/runner", () => ({ runOperationInProcess: mocks.run }));
vi.mock("@/lib/operations/biochar-products", () => ({ makeBiocharProduct: { id: "make_biochar_product" }, updateBiocharProduct: { id: "update_biochar_product" } }));
vi.mock("@/data-access/deliveries", () => ({}));
vi.mock("@/lib/operations/deliveries", () => ({ recordDeliveryForUi: { id: "record_posted_delivery" }, updateDelivery: mocks.update }));
vi.mock("@/data-access/delivery-stats", () => ({}));
vi.mock("@/data-access/utils", () => ({}));
vi.mock("@/db/schema", () => ({ biocharProducts: { code: "code" }, deliveries: { code: "code" } }));
vi.mock("@/data-access/code-generator", () => ({ withAutoCode: mocks.autoCode, CODE_CONFLICT_MESSAGES: { biocharProduct: "Product code conflict", delivery: "Delivery code conflict" } }));
import { createBiocharProductFn } from "./biochar-products";
import { createDeliveryFn, updateDeliveryFn } from "./deliveries";

const id = "00000000-0000-4000-8000-000000000001";
const ctx: OrgContext = { userId: "user", organizationId: "org", orgRole: "admin", isPlatformAdmin: false };
const common = { facilityId: id, storageLocationId: id, idempotencyKey: "stable-key", basisFingerprint: "stale-basis", moistureContentPercent: 20 };
const product = { ...common, formulationId: id, placedAt: "2026-09-15T12:00:00.000Z", sourceBiocharStorageLocationId: id, status: "testing" as const, massKg: 100, waterAddedKg: 0, densityKgM3: null };
const delivery = { ...common, code: "DL-001", orderId: id, deliveryDate: new Date("2026-09-15T00:00:00Z"), status: "delivered" as const, deliveredWetMassKg: 100 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue(ctx);
  mocks.run.mockReset();
  mocks.autoCode.mockImplementation(async (_ctx, _prefix, _table, _column, code, create) => create(code ?? "BP-001"));
});

for (const action of [
  { name: "delivery", call: () => createDeliveryFn(delivery), invalid: () => createDeliveryFn({ ...delivery, storageLocationId: "invalid" }), prefix: "DL", code: "DL-001", fallback: "Delivery was not created. Try again.", log: "delivery action failed", op: "delivery:create" },
]) describe(`${action.name} posting boundary`, () => {
  it("preserves typed stale-bin conflicts", async () => {
    const conflict = { entity: "storageLocation", id, code: conflictCode("BIN-001") };
    mocks.run.mockRejectedValue(new ActionConflictError("Stock changed. Review the refreshed preview.", conflict));
    expect(await action.call()).toEqual({ success: false, error: "Stock changed. Review the refreshed preview.", code: "conflict", conflict });
    expect(mocks.log).not.toHaveBeenCalled();
  });
  it("preserves native saved products and sends the UI key and code through the runner", async () => {
    const saved = { id, code: "SAVED", savedProducts: [{ id, stockPostingSequence: BigInt(1) }] };
    mocks.run.mockResolvedValue({ delivery: saved });
    expect(await action.call()).toEqual({ success: true, data: saved });
    expect(mocks.run).toHaveBeenCalledWith({ id: "record_posted_delivery" }, ctx, expect.objectContaining({ idempotencyKey: common.idempotencyKey, basisFingerprint: common.basisFingerprint, moisturePercent: 20, code: delivery.code, deliveredAt: delivery.deliveryDate }));
    expect(mocks.run.mock.calls[0][2]).not.toHaveProperty("facilityId");
    expect(mocks.autoCode).not.toHaveBeenCalled();
  });
  it("validates before posting", async () => {
    expect(await action.invalid()).toMatchObject({ success: false });
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("requires organization authentication", async () => {
    mocks.auth.mockRejectedValue(new Error("No session"));
    expect(await action.call()).toMatchObject({ success: false });
    expect(mocks.autoCode).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("preserves safe fallback and log context", async () => {
    mocks.run.mockRejectedValue(new Error("internal failure"));
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
    mocks.run.mockResolvedValue({ delivery: { id, code: "DL-001" } });
    expect(await createDeliveryFn({ ...splitDelivery, sources })).toMatchObject({ success: true });
    expect(mocks.run).toHaveBeenCalledWith({ id: "record_posted_delivery" }, ctx, expect.objectContaining({ sources, moisturePercent: undefined }));
  });
  it("refuses a sub-bin listed twice before posting", async () => {
    const sources = [{ layerId: p1, moisturePercent: 20 }, { layerId: p1, moisturePercent: 25 }];
    expect(await createDeliveryFn({ ...splitDelivery, sources })).toMatchObject({ success: false });
    expect(mocks.run).not.toHaveBeenCalled();
  });
});

describe("product posting boundary", () => {
  const saved = { id, code: "BP-26-001" };
  const created = { product: saved, basisFingerprint: "product-basis" };

  it("runs make_biochar_product with the biochar as weighed, the form's fingerprint and request key", async () => {
    mocks.run.mockResolvedValue(created);
    expect(await createBiocharProductFn(product)).toEqual({ success: true, data: saved });
    expect(mocks.run).toHaveBeenCalledWith({ id: "make_biochar_product" }, ctx, {
      facilityId: id, formulationId: id, placedAt: product.placedAt, status: "testing", sourceBiocharStorageLocationId: id, storageLocationId: id,
      biocharWetMassKg: 100, biocharMoisturePercent: 20, waterAddedKg: 0, densityKgM3: null, ingredients: [],
      basisFingerprint: "stale-basis", idempotencyKey: "stable-key",
    });
  });
  it("hands the operation the biochar only: the blend less every recorded ingredient", async () => {
    mocks.run.mockResolvedValue(created);
    const ingredient = { formulationIngredientId: id, feedstockTypeId: id, feedstockTypeName: "Compost", feedstockTypeCategory: "compost", storageLocationId: id, massKg: 20.125, moistureContentPercent: 30 };
    await createBiocharProductFn({ ...product, massKg: 120.125, ingredientBins: [ingredient] });
    expect(mocks.run.mock.calls[0][2]).toMatchObject({ biocharWetMassKg: 100, ingredients: [{ formulationIngredientId: id, storageLocationId: id, wetMassKg: 20.125, moisturePercent: 30 }] });
  });
  it("keeps the bin conflict when the stock basis moved", async () => {
    const conflict = { entity: "storageLocation", id, code: conflictCode("BIN-001") };
    mocks.run.mockRejectedValue(new DomainError("stock_basis_changed", "Stock changed since this preview. Refresh the preview and try again.", { conflict }));
    expect(await createBiocharProductFn(product)).toEqual({ success: false, error: "Stock changed since this preview. Refresh the preview and try again.", code: "stock_basis_changed", conflict });
    expect(mocks.log).not.toHaveBeenCalled();
  });
  it("validates before running the operation, and refuses a blend with no biochar", async () => {
    expect(await createBiocharProductFn({ ...product, formulationId: "invalid" })).toMatchObject({ success: false });
    const allIngredient = { formulationIngredientId: id, feedstockTypeId: id, feedstockTypeName: "Compost", feedstockTypeCategory: "compost", massKg: 100, moistureContentPercent: 30 };
    expect(await createBiocharProductFn({ ...product, ingredientBins: [allIngredient] })).toEqual({ success: false, error: "A product requires positive source biochar." });
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("requires organization authentication", async () => {
    mocks.auth.mockRejectedValue(new Error("No session"));
    expect(await createBiocharProductFn(product)).toMatchObject({ success: false });
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("preserves safe fallback and log context", async () => {
    mocks.run.mockRejectedValue(new Error("internal failure"));
    expect(await createBiocharProductFn(product)).toEqual({ success: false, error: "Biochar product was not created. Try again." });
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ op: "biochar-product:create" }), "biochar product action failed");
  });
});

describe("product creation split-bin sources", () => {
  const r1 = "00000000-0000-4000-8000-000000000004";
  const r2 = "00000000-0000-4000-8000-000000000005";
  // A split biochar bin carries a reading per sub-bin instead of one biochar moisture.
  const splitProduct = { ...product, moistureContentPercent: undefined };

  it("hands the ordered run readings to the operation in place of one moisture", async () => {
    const sources = [{ layerId: r2, moisturePercent: 20 }, { layerId: r1, moisturePercent: 10 }];
    mocks.run.mockResolvedValue({ product: { id, code: "BP-001" }, basisFingerprint: "basis" });
    expect(await createBiocharProductFn({ ...splitProduct, sources })).toMatchObject({ success: true });
    expect(mocks.run.mock.calls[0][2]).toMatchObject({ sources });
    expect(mocks.run.mock.calls[0][2]).not.toHaveProperty("biocharMoisturePercent");
  });
  it("refuses a run listed twice, and a draw with neither moisture nor readings, before posting", async () => {
    expect(await createBiocharProductFn({ ...splitProduct, sources: [{ layerId: r1, moisturePercent: 20 }, { layerId: r1, moisturePercent: 25 }] })).toMatchObject({ success: false });
    expect(await createBiocharProductFn(splitProduct)).toMatchObject({ success: false });
    expect(mocks.run).not.toHaveBeenCalled();
  });
});


describe("delivery action field mapping and partial notes", () => {
  it("keeps a lineage refusal readable in the update form's banner", async () => {
    const message = "Delivery DL-001 is locked by a certification submission.";
    const issues = [{ path: ["deliveryId"], code: "certification_locked", message }];
    mocks.update.mockRejectedValueOnce(new DomainError("certification_locked", message, { issues }));
    const result = await updateDeliveryFn({ deliveryId: id, expectedVersion: 1 });
    expect(result).toEqual({ success: false, error: message, code: "certification_locked", issues });
    if (result.success) throw new Error("Expected a lineage refusal");
    try { throwDeliveryActionError(result); }
    catch (error) {
      expect(error).toMatchObject({ message, issues });
      expect(deliveryActionFieldIssues(error, ["deliveryDate", "deliveredWetMassKg"])).toBeUndefined();
    }
    expect(mocks.log).not.toHaveBeenCalled();
  });
  it("maps the future instant issue to deliveryDate", async () => {
    mocks.run.mockRejectedValue(new DomainError("validation_failed", "Date and time cannot be in the future.", { issues: [{ path: ["deliveredAt"], code: "validation_failed", message: "Date and time cannot be in the future." }] }));
    expect(await createDeliveryFn(delivery)).toMatchObject({ success: false, issues: [{ path: ["deliveryDate"] }] });
  });
  it("keeps an omitted note and lets an empty form field clear it", async () => {
    mocks.update.mockResolvedValue({ id });
    await updateDeliveryFn({ deliveryId: id, expectedVersion: 1 });
    expect(mocks.update).toHaveBeenLastCalledWith(ctx, id, expect.objectContaining({ distanceNote: undefined }));
    await updateDeliveryFn({ deliveryId: id, expectedVersion: 1, distanceNote: "" });
    expect(mocks.update).toHaveBeenLastCalledWith(ctx, id, expect.objectContaining({ distanceNote: null }));
  });
});

it("preserves preview and unexpected cause when remapping delivery issues", async () => {
  const preview = { basisFingerprint: "fresh", stockEffects: [] };
  mocks.run.mockRejectedValue(new DomainError("stock_basis_changed", "Refresh the preview.", {
    preview, cause: new Error("Unexpected cause"), retryable: true, retryAfterSeconds: 2,
    issues: [{ path: ["moisturePercent"], code: "validation_failed", message: "Enter moisture." }],
  }));
  expect(await createDeliveryFn(delivery)).toMatchObject({ success: false, preview, issues: [{ path: ["moistureContentPercent"] }] });
  expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ op: "delivery:create", errorName: "Error" }), "delivery action failed");
});

it("preserves update field refusals for the delivery form without a fallback banner message", async () => {
  mocks.update.mockRejectedValueOnce(new DomainError("validation_failed", "Enter a valid mass.", {
    issues: [{ path: ["deliveredWetMassKg"], code: "validation_failed", message: "Enter a valid mass." }],
  }));
  expect(await updateDeliveryFn({ deliveryId: id, expectedVersion: 1, deliveredWetMassKg: 100 })).toMatchObject({
    success: false, code: "validation_failed", issues: [{ path: ["deliveredWetMassKg"], message: "Enter a valid mass." }],
  });
  expect(mocks.log).not.toHaveBeenCalled();
});
