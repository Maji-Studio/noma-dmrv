import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/log", () => ({ logger: { error: vi.fn(), warn: vi.fn(), child: vi.fn() } }));
import { OutputStockShortageError, STOCK_CHANGED_MESSAGE, StockBasisChangedError } from "@/data-access/output-stock-errors";
import { overdrawError } from "@/data-access/stock-overdraw-error";
import { staleRowVersion } from "@/data-access/row-version";
import { toActionFailure } from "@/fn/action-errors";
import { conflictCode } from "@/lib/conflict-ref";
import { DomainError } from "@/lib/domain-errors";
import { ActionConflictError, SafeError } from "@/lib/errors";
import { withFeedstockErrors } from "@/lib/feedstock-domain-errors";
import { withOutputStockErrors } from "./output-stock-domain-errors";

const failing = (error: unknown) => async () => { throw error; };
const failureOptions = { fallbackMessage: "Failed to save", log: { message: "test" } };
const shortageMessage = "Not enough dry biochar in the selected bin for this wet mass at this moisture. Reduce the wet mass or choose another bin.";
const shortage = { storageLocationId: "bin-id", availableSolidsKg: 1820, requestedSolidsKg: 2125 };

describe("withOutputStockErrors", () => {
  it("passes typed failures and unexpected errors through untouched", async () => {
    for (const error of [staleRowVersion("biocharProduct", "product-id"), new DomainError("not_found", "Bin was not found."), new Error("Database unavailable")]) {
      await expect(withOutputStockErrors(failing(error))).rejects.toBe(error);
    }
  });

  it("returns the work's result when nothing fails", async () => {
    await expect(withOutputStockErrors(async () => "posted")).resolves.toBe("posted");
  });

  it("turns a stale stock basis into stock_basis_changed, keeping the message and the bin", async () => {
    const refusal = new StockBasisChangedError({ id: "bin-id", code: "BC-01" });
    const error = await withOutputStockErrors(failing(refusal)).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({ code: "stock_basis_changed", message: STOCK_CHANGED_MESSAGE, conflict: refusal.conflict });
    expect((error as DomainError).preview).toBeUndefined();
    expect(toActionFailure(error, failureOptions)).toEqual({ success: false, code: "stock_basis_changed", error: STOCK_CHANGED_MESSAGE, conflict: refusal.conflict });
  });

  it("carries an adapter's preview on stock_basis_changed through the action failure", () => {
    const preview = { basisFingerprint: "fresh", stockEffects: [] };
    const error = new DomainError("stock_basis_changed", STOCK_CHANGED_MESSAGE, { preview });
    expect(toActionFailure(error, failureOptions)).toMatchObject({ code: "stock_basis_changed", preview });
  });

  it("turns an output-bin shortage into insufficient_stock with solids in kilograms on the default pointer", async () => {
    await expect(withOutputStockErrors(failing(new OutputStockShortageError(shortageMessage, shortage)))).rejects.toMatchObject({
      code: "insufficient_stock", message: shortageMessage,
      issues: [{ path: ["wetMassKg"], code: "insufficient_stock", message: shortageMessage, meta: { ...shortage, unit: "kg" } }],
    });
  });

  it("points a short sub-bin at the source the caller names", async () => {
    const details = { ...shortage, layerId: "run-2" };
    const sources = ["run-1", "run-2"];
    await expect(withOutputStockErrors(failing(new OutputStockShortageError(shortageMessage, details)), {
      shortage: (detail) => detail.layerId ? ["sources", sources.indexOf(detail.layerId), "layerId"] : ["biocharWetMassKg"],
    })).rejects.toMatchObject({ issues: [{ path: ["sources", 1, "layerId"], meta: { layerId: "run-2", unit: "kg" } }] });
    await expect(withOutputStockErrors(failing(new OutputStockShortageError(shortageMessage, shortage)), { shortage: ["biocharWetMassKg"] }))
      .rejects.toMatchObject({ issues: [{ path: ["biocharWetMassKg"] }] });
  });

  it("turns an ingredient-bin overdraw into insufficient_stock in wet kilograms on the ingredient pointer", async () => {
    const details = { storageLocationId: "ingredient-bin", availableWetKg: 20, requestedWetKg: 30 };
    const refusal = overdrawError("feedstock", details);
    await expect(withOutputStockErrors(failing(refusal))).rejects.toMatchObject({
      code: "insufficient_stock", message: refusal.message, issues: [{ path: ["ingredients"], meta: { ...details, unit: "kg" } }],
    });
    await expect(withOutputStockErrors(failing(refusal), { ingredient: () => ["ingredients", 2, "storageLocationId"] }))
      .rejects.toMatchObject({ issues: [{ path: ["ingredients", 2, "storageLocationId"] }] });
  });

  it("treats an overdraw without bin details as a plain refusal", async () => {
    const refusal = overdrawError("feedstock");
    await expect(withOutputStockErrors(failing(refusal))).rejects.toMatchObject({ code: "validation_failed", message: refusal.message });
  });

  it("keeps other conflicts as conflict with their blockers", async () => {
    const conflict = { entity: "binMovement", id: "movement-id", code: conflictCode("Loss") };
    const blockers = [{ entity: "removal", id: "removal-id", code: conflictCode("Removal") }];
    await expect(withOutputStockErrors(failing(new ActionConflictError("Correction blocked by a later loss.", conflict, { blockers }))))
      .rejects.toMatchObject({ code: "conflict", message: "Correction blocked by a later loss.", conflict, blockers });
  });

  it("keeps the exact guard message as validation_failed, on a pointer only when given", async () => {
    const message = "Choose a biochar bin for product creation.";
    const plain = await withOutputStockErrors(failing(new SafeError(message))).catch((caught: unknown) => caught as DomainError);
    expect(plain).toMatchObject({ code: "validation_failed", message, issues: [] });
    await expect(withOutputStockErrors(failing(new SafeError(message)), { validation: ["storageLocationId"] }))
      .rejects.toMatchObject({ issues: [{ path: ["storageLocationId"], code: "validation_failed", message }] });
  });

  it("keeps a certification-lineage refusal typed when its call site is wrapped as 4a does", async () => {
    const message = "This production run is part of a submitted removal and cannot be changed.";
    const lineage = () => withFeedstockErrors(failing(new SafeError(message)), "certification_locked");
    await expect(withOutputStockErrors(lineage)).rejects.toMatchObject({ code: "certification_locked", message });
  });
});

describe("existing UI behaviour", () => {
  it("still shows a stale stock basis as a refresh conflict on the bin", () => {
    const refusal = new StockBasisChangedError({ id: "bin-id", code: "BC-01" });
    expect(refusal).toBeInstanceOf(ActionConflictError);
    expect(refusal.name).toBe("ActionConflictError");
    expect(toActionFailure(refusal, failureOptions)).toEqual({
      success: false, code: "conflict", error: "Stock changed since this preview. Refresh the preview and try again.",
      conflict: { entity: "storageLocation", id: "bin-id", code: "BC-01" },
    });
  });

  it("still shows a shortage as the planner's blocking message", () => {
    const refusal = new OutputStockShortageError(shortageMessage, shortage);
    expect(refusal).toBeInstanceOf(SafeError);
    expect(toActionFailure(refusal, failureOptions)).toEqual({ success: false, error: shortageMessage });
  });
});
