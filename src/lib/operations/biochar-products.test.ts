import { beforeEach, describe, expect, it, vi } from "vitest";
import { conflictCode } from "@/lib/conflict-ref";
import { DomainError } from "@/lib/domain-errors";
import { SafeError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({ facility: vi.fn(), lines: vi.fn(), create: vi.fn(), update: vi.fn(), autoCodes: vi.fn() }));
vi.mock("@/data-access/biochar-product-input", () => ({ readProductFacility: mocks.facility, readProductFormulationLines: mocks.lines }));
vi.mock("@/data-access/biochar-product-create", () => ({ createBiocharProductInTransaction: mocks.create }));
vi.mock("@/data-access/biochar-product-update", () => ({ updateBiocharProductInTransaction: mocks.update }));
vi.mock("@/data-access/code-generator", () => ({ withAutoCodes: mocks.autoCodes, CODE_CONFLICT_MESSAGES: { biocharProduct: "A biochar product with this code already exists" } }));
vi.mock("@/data-access/output-stock-post", () => ({ readOutputStockBin: vi.fn(), recordOutputStockMovementInTransaction: vi.fn() }));
import { OutputStockShortageError, StockBasisChangedError } from "@/data-access/output-stock-errors";
import { overdrawError } from "@/data-access/stock-overdraw-error";
import { makeBiocharProductApiInput, makeBiocharProductInput, updateBiocharProductApiInput, updateBiocharProductInput } from "@/schemas/biochar-product-input";
import type { OperationScope } from "./runner";
import { makeBiocharProduct, updateBiocharProduct } from "./biochar-products";
import { GENERATED_MOVEMENT_KEY_PREFIX } from "./output-stock";

const FACILITY_ID = "00000000-0000-4000-8000-000000000001";
const RECIPE_ID = "00000000-0000-4000-8000-000000000002";
const SOURCE_ID = "00000000-0000-4000-8000-000000000003";
const PRODUCT_BIN_ID = "00000000-0000-4000-8000-000000000004";
const LINE_ID = "00000000-0000-4000-8000-000000000005";
const INGREDIENT_BIN_ID = "00000000-0000-4000-8000-000000000006";
const RUN_A = "00000000-0000-4000-8000-00000000000a";
const RUN_B = "00000000-0000-4000-8000-00000000000b";
const PRODUCT_ID = "00000000-0000-4000-8000-00000000000c";
const ctx = { organizationId: "org", userId: "user", orgRole: "owner" as const, isPlatformAdmin: false };
const tx = { tx: true } as unknown as OperationScope["tx"];
const savepoint = { savepoint: true };
const snapshotStock = vi.fn();
const scope: OperationScope = { ctx, tx, snapshotStock, afterCommit: vi.fn() };
const line = { id: LINE_ID, feedstockTypeId: "type", feedstockTypeName: "Compost", feedstockTypeCategory: "compost", ratio: 0.2 };
const blended = {
  facilityId: FACILITY_ID, formulationId: RECIPE_ID, placedAt: "2026-09-14T12:00:00Z", sourceBiocharStorageLocationId: SOURCE_ID,
  storageLocationId: PRODUCT_BIN_ID, biocharWetMassKg: 100.125, biocharMoisturePercent: 10, waterAddedKg: 5,
  ingredients: [{ formulationIngredientId: LINE_ID, storageLocationId: INGREDIENT_BIN_ID, wetMassKg: 20.25, moisturePercent: 30 }],
};
const make = (input: unknown) => makeBiocharProduct.execute(scope, makeBiocharProductInput.parse(input));
const created = { product: { id: PRODUCT_ID, version: 1 }, basisFingerprint: "product-basis" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.facility.mockResolvedValue({ id: FACILITY_ID, timeZone: "Africa/Dar_es_Salaam" });
  mocks.lines.mockResolvedValue([line]);
  mocks.create.mockResolvedValue(created);
  mocks.autoCodes.mockImplementation(async (_ctx, _tx, _prefix, _table, _column, _count, insert) => insert(["BP-26-001"], savepoint));
});

describe("make_biochar_product", () => {
  it("derives the blend, snapshots the formulation lines and creates inside each code attempt's savepoint", async () => {
    await expect(make(blended)).resolves.toEqual(created);
    expect(mocks.autoCodes).toHaveBeenCalledWith(ctx, tx, "BP", expect.anything(), expect.anything(), 1, expect.any(Function), "A biochar product with this code already exists");
    const [, writer, data, options] = mocks.create.mock.calls[0];
    expect(writer).toBe(savepoint);
    expect(options).toEqual({ snapshotStock });
    expect(data).toMatchObject({
      code: "BP-26-001", facilityId: FACILITY_ID, placedAt: "2026-09-14T12:00:00.000Z", status: "testing",
      // 100.125 kg biochar and 20.25 kg ingredient, before the 5 kg of water.
      massKg: 120.375, moistureContentPercent: 10, waterAddedKg: 5, densityKgM3: null, basisFingerprint: undefined,
      composition: { ingredients: [{ formulationIngredientId: LINE_ID, feedstockTypeId: "type", feedstockTypeName: "Compost", feedstockTypeCategory: "compost",
        ratio: 0.2, storageLocationId: INGREDIENT_BIN_ID, massKg: 20.25, moistureContentPercent: 30 }] },
    });
  });

  it("reads a facility-local placement in the facility zone and generates a movement key per execution", async () => {
    await make({ ...blended, placedAt: { date: "2026-09-14", time: "15:00" } });
    await make(blended);
    const [first, second] = mocks.create.mock.calls.map((call) => call[2]);
    expect(first.placedAt).toBe("2026-09-14T12:00:00.000Z");
    expect(first.idempotencyKey).toMatch(new RegExp(`^${GENERATED_MOVEMENT_KEY_PREFIX}[0-9a-f-]{36}$`));
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it("keeps the form's request key and the dry run's fingerprint", async () => {
    await make({ ...blended, idempotencyKey: "form-key", basisFingerprint: "product-basis" });
    expect(mocks.create.mock.calls[0][2]).toMatchObject({ idempotencyKey: "form-key", basisFingerprint: "product-basis" });
  });

  it("records the composition in recipe order, whatever order the lines were sent in", async () => {
    const second = { ...line, id: RUN_A, feedstockTypeId: "other" };
    mocks.lines.mockResolvedValue([line, second]);
    const other = { formulationIngredientId: RUN_A, storageLocationId: null, wetMassKg: 0 };
    await make({ ...blended, ingredients: [other, blended.ingredients[0]] });
    const { ingredients } = mocks.create.mock.calls[0][2].composition;
    expect(ingredients.map((row: { formulationIngredientId: string }) => row.formulationIngredientId)).toEqual([LINE_ID, RUN_A]);
  });

  it("records a Pure biochar product with no composition", async () => {
    mocks.lines.mockResolvedValue([]);
    const { ingredients: _none, ...pure } = blended;
    void _none;
    await make(pure);
    expect(mocks.create.mock.calls[0][2]).toMatchObject({ massKg: 100.125, composition: {} });
  });

  it("refuses an ingredient outside the formulation, and a formulation line left out", async () => {
    mocks.lines.mockResolvedValue([{ ...line, id: RUN_A }]);
    await expect(make(blended)).rejects.toMatchObject({ code: "validation_failed", issues: [{ path: ["ingredients", 0, "formulationIngredientId"] }] });
    mocks.lines.mockResolvedValue([line, { ...line, id: RUN_A }]);
    await expect(make(blended)).rejects.toMatchObject({ code: "validation_failed", issues: [{ path: ["ingredients"] }] });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("answers a moved basis with stock_basis_changed and keeps the bin conflict", async () => {
    mocks.create.mockRejectedValue(new StockBasisChangedError({ id: SOURCE_ID, code: "BC-001" }));
    await expect(make({ ...blended, basisFingerprint: "stale" })).rejects.toMatchObject({
      code: "stock_basis_changed", conflict: { entity: "storageLocation", id: SOURCE_ID, code: conflictCode("BC-001") },
    });
  });

  it("types shortages with a measure and points them at the field that drew too much", async () => {
    mocks.create.mockRejectedValueOnce(new OutputStockShortageError("Short.", { storageLocationId: SOURCE_ID, measure: "dry_biochar", availableSolidsKg: 1, requestedSolidsKg: 2 }));
    await expect(make(blended)).rejects.toMatchObject({ code: "insufficient_stock", issues: [{ path: ["biocharWetMassKg"], meta: { measure: "dry_biochar", unit: "kg" } }] });
    const sources = [{ layerId: RUN_A, moisturePercent: 10 }, { layerId: RUN_B, moisturePercent: 20 }];
    const split = { ...blended, biocharMoisturePercent: undefined, sources };
    mocks.create.mockRejectedValueOnce(new OutputStockShortageError("Short.", { storageLocationId: SOURCE_ID, layerId: RUN_B, measure: "dry_biochar", availableSolidsKg: 1, requestedSolidsKg: 2 }));
    await expect(make(split)).rejects.toMatchObject({ code: "insufficient_stock", issues: [{ path: ["sources", 1] }] });
    mocks.create.mockRejectedValueOnce(overdrawError("feedstock", { storageLocationId: INGREDIENT_BIN_ID, availableWetKg: 10, requestedWetKg: 20.25 }));
    await expect(make(blended)).rejects.toMatchObject({ code: "insufficient_stock",
      issues: [{ path: ["ingredients", 0, "wetMassKg"], meta: { storageLocationId: INGREDIENT_BIN_ID, availableWetKg: 10, requestedWetKg: 20.25, measure: "ingredient_wet_stock", unit: "kg" } }] });
  });

  it("keeps an invalid sub-bin selection a validation failure, not a shortage", async () => {
    mocks.create.mockRejectedValue(new SafeError("This load is used up before it reaches RUN-2. Untick RUN-2."));
    await expect(make(blended)).rejects.toMatchObject({ code: "validation_failed", message: "This load is used up before it reaches RUN-2. Untick RUN-2." });
  });

  it("passes not-found references through", async () => {
    mocks.facility.mockRejectedValue(new DomainError("not_found", "Facility not found or archived", { issues: [{ path: ["facilityId"], code: "not_found", message: "Facility not found or archived" }] }));
    await expect(make(blended)).rejects.toMatchObject({ code: "not_found", issues: [{ path: ["facilityId"] }] });
  });

  it("describes the created product without request facts", () => {
    const effect = makeBiocharProduct.describe!(makeBiocharProductInput.parse({ ...blended, basisFingerprint: "b", idempotencyKey: "k" }), created as never);
    expect(effect).toMatchObject({ outcome: "created", entityType: "biocharProduct", entityIds: [PRODUCT_ID], versionAfter: 1 });
    expect(effect.changedFields).not.toContain("basisFingerprint");
    expect(effect.changedFields).not.toContain("idempotencyKey");
  });
});

describe("update_biochar_product", () => {
  it("edits the named product with the version it was read at", async () => {
    mocks.update.mockResolvedValue({ id: PRODUCT_ID, version: 3 });
    await updateBiocharProduct.execute(scope, updateBiocharProductInput.parse({ biocharProductId: PRODUCT_ID, expectedVersion: 2, status: "ready", densityKgM3: null }));
    expect(mocks.update).toHaveBeenCalledWith(ctx, tx, PRODUCT_ID, { expectedVersion: 2, status: "ready", densityKgM3: null });
  });

  it("keeps an immutable-fact refusal a validation failure and a lineage refusal typed", async () => {
    mocks.update.mockRejectedValueOnce(new SafeError("Posted product source, composition, placement, and bin are immutable. Use an explicit stock correction."));
    await expect(updateBiocharProduct.execute(scope, updateBiocharProductInput.parse({ biocharProductId: PRODUCT_ID, expectedVersion: 2, massKg: 1 })))
      .rejects.toMatchObject({ code: "validation_failed" });
    mocks.update.mockRejectedValueOnce(new DomainError("certification_locked", "Biochar product is locked by a certification submission."));
    await expect(updateBiocharProduct.execute(scope, updateBiocharProductInput.parse({ biocharProductId: PRODUCT_ID, expectedVersion: 2, status: "sold" })))
      .rejects.toMatchObject({ code: "certification_locked" });
  });
});

describe("published inputs (decision 52)", () => {
  it("defaults the status and takes no ingredients for Pure biochar", () => {
    const { ingredients: _none, ...pure } = blended;
    void _none;
    expect(makeBiocharProductApiInput.parse(pure)).toMatchObject({ status: "testing", ingredients: [] });
  });

  it.each(["code", "idempotencyKey", "expectedProductVersions", "massKg"])("refuses %s on the published create body", (field) => {
    expect(makeBiocharProductApiInput.safeParse({ ...blended, [field]: field === "expectedProductVersions" ? {} : "x" }).success).toBe(false);
  });

  it("requires the water added, with no default", () => {
    const { waterAddedKg: _water, ...dry } = blended;
    void _water;
    expect(makeBiocharProductApiInput.safeParse(dry).error?.issues[0].path).toEqual(["waterAddedKg"]);
  });

  it("takes the biochar moisture or the sub-bins drawn, never neither or both", () => {
    const sources = [{ layerId: RUN_A, moisturePercent: 10 }];
    expect(makeBiocharProductApiInput.safeParse({ ...blended, biocharMoisturePercent: undefined }).error?.issues[0].path).toEqual(["biocharMoisturePercent"]);
    expect(makeBiocharProductApiInput.safeParse({ ...blended, sources }).error?.issues[0].path).toEqual(["biocharMoisturePercent"]);
    expect(makeBiocharProductApiInput.safeParse({ ...blended, biocharMoisturePercent: undefined, sources }).success).toBe(true);
  });

  it("requires a measured moisture for an ingredient used, and each formulation line once", () => {
    const used = { ...blended.ingredients[0], moisturePercent: undefined };
    expect(makeBiocharProductApiInput.safeParse({ ...blended, ingredients: [used] }).error?.issues[0].path).toEqual(["ingredients", 0, "moisturePercent"]);
    expect(makeBiocharProductApiInput.safeParse({ ...blended, ingredients: [{ ...used, wetMassKg: 0 }] }).success).toBe(true);
    expect(makeBiocharProductApiInput.safeParse({ ...blended, ingredients: [blended.ingredients[0], blended.ingredients[0]] }).error?.issues[0].path)
      .toEqual(["ingredients", 1, "formulationIngredientId"]);
  });

  it("publishes only code, status and density on update", () => {
    expect(updateBiocharProductApiInput.parse({ code: "BP-26-009", status: "ready", densityKgM3: null })).toEqual({ code: "BP-26-009", status: "ready", densityKgM3: null });
    for (const field of ["massKg", "placedAt", "storageLocationId", "expectedVersion", "biocharProductId"]) {
      expect(updateBiocharProductApiInput.safeParse({ [field]: 1 }).success).toBe(false);
    }
  });
});
