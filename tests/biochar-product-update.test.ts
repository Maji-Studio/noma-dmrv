import { describe, expect, it, vi, beforeEach } from "vitest";

const mockRunOperationInProcess = vi.fn();

vi.mock("@/lib/auth/server", () => ({
  requireOrgContext: vi.fn().mockResolvedValue({
    userId: "user-123",
    organizationId: "org_test_fixtures",
    orgRole: "owner",
    isPlatformAdmin: false,
  }),
}));

vi.mock("@/data-access/biochar-products", () => ({
  deleteBiocharProduct: vi.fn(),
  getBiocharProducts: vi.fn(),
  getBiocharProductById: vi.fn(),
}));

// The action runs `update_biochar_product` in process; the runner is mocked.
vi.mock("@/lib/operations/runner", () => ({
  runOperationInProcess: (...args: unknown[]) => mockRunOperationInProcess(...args),
}));
vi.mock("@/lib/operations/biochar-products", () => ({
  makeBiocharProduct: { id: "make_biochar_product" },
  updateBiocharProduct: { id: "update_biochar_product" },
}));

import { updateBiocharProductFn } from "@/fn/biochar-products";

const PRODUCT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

beforeEach(() => {
  mockRunOperationInProcess.mockReset();
  mockRunOperationInProcess.mockResolvedValue({
    id: PRODUCT_ID,
    code: "BP-001",
    facilityId: "fac-1",
    formulationId: "form-1",
  });
});

/**
 * These tests prove the fn is wired to the composition helper correctly and
 * hands the result to the update operation as its `composition`.
 * The helper's tri-state semantics are unit-tested in `biochar-composition.test.ts`.
 */
describe("updateBiocharProductFn composition handling", () => {
  it("omitting ingredientBins preserves existing composition (no composition key in payload)", async () => {
    await updateBiocharProductFn({ expectedVersion: 1,
      productId: PRODUCT_ID,
      massKg: 100,
    });

    expect(mockRunOperationInProcess).toHaveBeenCalledOnce();
    const passedData = mockRunOperationInProcess.mock.calls[0][2];
    expect(passedData).not.toHaveProperty("composition");
    expect(passedData).toMatchObject({ biocharProductId: PRODUCT_ID, expectedVersion: 1, massKg: 100 });
  });

  it("explicit ingredientBins array writes composition", async () => {
    const bins = [
      {
        formulationIngredientId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        feedstockTypeId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        feedstockTypeName: "Compost",
        feedstockTypeCategory: "compost",
        ratio: 0.8,
        massKg: 80,
        moistureContentPercent: 0,
      },
    ];

    await updateBiocharProductFn({ expectedVersion: 1,
      productId: PRODUCT_ID,
      ingredientBins: bins,
    });

    expect(mockRunOperationInProcess).toHaveBeenCalledOnce();
    const passedData = mockRunOperationInProcess.mock.calls[0][2];
    expect(passedData.composition).toEqual({ ingredients: bins });
  });

  it("accepts a status edit carrying saved ingredient mass with null moisture", async () => {
    const ingredientBins = [{
      formulationIngredientId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      feedstockTypeId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      feedstockTypeName: "Compost", feedstockTypeCategory: "compost",
      massKg: 80, massDryKg: 64, moistureContentPercent: null,
    }];
    const result = await updateBiocharProductFn({
      productId: PRODUCT_ID, expectedVersion: 1, status: "ready", ingredientBins,
    });
    expect(result.success).toBe(true);
    expect(mockRunOperationInProcess.mock.calls[0][2]).toMatchObject({
      status: "ready", composition: { ingredients: ingredientBins },
    });
  });

  it("explicit empty ingredientBins array clears composition", async () => {
    await updateBiocharProductFn({ expectedVersion: 1,
      productId: PRODUCT_ID,
      ingredientBins: [],
    });

    expect(mockRunOperationInProcess).toHaveBeenCalledOnce();
    const passedData = mockRunOperationInProcess.mock.calls[0][2];
    expect(passedData.composition).toEqual({});
  });
});
