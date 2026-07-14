import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  NOT_FOUND_ERROR,
  mockRequireOrgContext,
  mockGetCreditBatchById,
  mockGetSupplierById,
  mockGetCustomerById,
} = vi.hoisted(() => ({
  NOT_FOUND_ERROR: "NEXT_NOT_FOUND",
  mockRequireOrgContext: vi.fn(),
  mockGetCreditBatchById: vi.fn(),
  mockGetSupplierById: vi.fn(),
  mockGetCustomerById: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error(NOT_FOUND_ERROR);
  },
  redirect: vi.fn(),
}));
vi.mock("@/lib/auth/server", () => ({
  requireOrgContext: mockRequireOrgContext,
}));
vi.mock("@/data-access/credit-batches", () => ({
  getCreditBatchById: mockGetCreditBatchById,
}));
vi.mock("@/components/credit-batches", () => ({
  CreditBatchDetail: () => null,
}));
vi.mock("@/data-access/entities/suppliers", () => ({
  getSupplierById: mockGetSupplierById,
}));
vi.mock("@/components/suppliers", () => ({ SupplierDetail: () => null }));
vi.mock("@/data-access/entities/customers", () => ({
  getCustomerById: mockGetCustomerById,
}));
vi.mock("@/components/customers", () => ({ CustomerDetail: () => null }));

import CreditBatchDetailPage from "@/app/(app)/credit-batches/[id]/page";
import SupplierDetailPage from "@/app/(app)/suppliers/[supplierId]/page";
import CustomerDetailPage from "@/app/(app)/customers/[customerId]/page";

const VALID_MISSING_ID = "11111111-1111-4111-8111-111111111111";

describe("detail route server preflights", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireOrgContext.mockResolvedValue({
      userId: "test-user",
      organizationId: "test-org",
    });
  });

  it("returns not found for a malformed credit-batch ID before querying", async () => {
    await expect(
      CreditBatchDetailPage({
        params: Promise.resolve({ id: "__missing__" }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow(NOT_FOUND_ERROR);

    expect(mockRequireOrgContext).not.toHaveBeenCalled();
    expect(mockGetCreditBatchById).not.toHaveBeenCalled();
  });

  it("returns not found for a malformed supplier ID before querying", async () => {
    await expect(
      SupplierDetailPage({
        params: Promise.resolve({ supplierId: "__missing__" }),
      }),
    ).rejects.toThrow(NOT_FOUND_ERROR);

    expect(mockRequireOrgContext).not.toHaveBeenCalled();
    expect(mockGetSupplierById).not.toHaveBeenCalled();
  });

  it("returns not found for a malformed customer ID before querying", async () => {
    await expect(
      CustomerDetailPage({
        params: Promise.resolve({ customerId: "__missing__" }),
      }),
    ).rejects.toThrow(NOT_FOUND_ERROR);

    expect(mockRequireOrgContext).not.toHaveBeenCalled();
    expect(mockGetCustomerById).not.toHaveBeenCalled();
  });

  it("returns not found for an absent credit-batch UUID", async () => {
    mockGetCreditBatchById.mockResolvedValue(null);

    await expect(
      CreditBatchDetailPage({
        params: Promise.resolve({ id: VALID_MISSING_ID }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow(NOT_FOUND_ERROR);

    expect(mockGetCreditBatchById).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "test-org" }),
      VALID_MISSING_ID,
      { skipPreview: true },
    );
  });

  it("returns not found for an absent supplier UUID", async () => {
    mockGetSupplierById.mockResolvedValue(null);

    await expect(
      SupplierDetailPage({
        params: Promise.resolve({ supplierId: VALID_MISSING_ID }),
      }),
    ).rejects.toThrow(NOT_FOUND_ERROR);

    expect(mockGetSupplierById).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "test-org" }),
      VALID_MISSING_ID,
    );
  });

  it("returns not found for an absent customer UUID", async () => {
    mockGetCustomerById.mockResolvedValue(null);

    await expect(
      CustomerDetailPage({
        params: Promise.resolve({ customerId: VALID_MISSING_ID }),
      }),
    ).rejects.toThrow(NOT_FOUND_ERROR);

    expect(mockGetCustomerById).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "test-org" }),
      VALID_MISSING_ID,
    );
  });
});
