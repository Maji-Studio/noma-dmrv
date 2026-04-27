import { describe, expect, it, vi, beforeEach } from "vitest";

const mockUpdateBiocharProduct = vi.fn();

vi.mock("@/lib/auth/server", () => ({
  getUser: vi.fn().mockResolvedValue({
    id: "user-123",
    email: "test@example.com",
    name: "Test",
    emailVerified: true,
    role: "admin" as const,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
  }),
}));

vi.mock("@/data-access/biochar-products", () => ({
  createBiocharProduct: vi.fn(),
  deleteBiocharProduct: vi.fn(),
  getBiocharProducts: vi.fn(),
  getBiocharProductById: vi.fn(),
  isBiocharProductCodeAvailable: vi.fn(),
  getBiocharProductOptions: vi.fn(),
  updateBiocharProduct: (...args: unknown[]) => mockUpdateBiocharProduct(...args),
}));

vi.mock("@/data-access/code-generator", () => ({
  withAutoCode: vi.fn(),
}));

import { updateBiocharProductFn } from "@/fn/biochar-products";

const PRODUCT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

beforeEach(() => {
  mockUpdateBiocharProduct.mockReset();
  mockUpdateBiocharProduct.mockResolvedValue({
    id: PRODUCT_ID,
    code: "BP-001",
    facilityId: "fac-1",
    formulationId: "form-1",
  });
});

describe("updateBiocharProductFn composition handling", () => {
  it("omitting ingredientBins preserves existing composition", async () => {
    await updateBiocharProductFn({
      productId: PRODUCT_ID,
      massKg: 100,
    });

    expect(mockUpdateBiocharProduct).toHaveBeenCalledOnce();
    const passedData = mockUpdateBiocharProduct.mock.calls[0][2];
    expect(passedData).not.toHaveProperty("composition");
  });

  it("explicit ingredientBins array writes composition", async () => {
    const bins = [
      {
        formulationIngredientId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        ingredientName: "Biochar",
        ingredientType: "biochar",
        ratio: 0.8,
        massKg: 80,
      },
    ];

    await updateBiocharProductFn({
      productId: PRODUCT_ID,
      ingredientBins: bins,
    });

    expect(mockUpdateBiocharProduct).toHaveBeenCalledOnce();
    const passedData = mockUpdateBiocharProduct.mock.calls[0][2];
    expect(passedData.composition).toEqual({ ingredients: bins });
  });

  it("explicit empty ingredientBins array clears composition", async () => {
    await updateBiocharProductFn({
      productId: PRODUCT_ID,
      ingredientBins: [],
    });

    expect(mockUpdateBiocharProduct).toHaveBeenCalledOnce();
    const passedData = mockUpdateBiocharProduct.mock.calls[0][2];
    expect(passedData.composition).toEqual({});
  });
});
