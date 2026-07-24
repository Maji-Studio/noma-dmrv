import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  NOT_FOUND_ERROR,
  mockRedirect,
  mockRequireOrgContext,
  mockGetCreditBatchById,
  mockGetSupplierById,
  mockGetCustomerById,
} = vi.hoisted(() => ({
  NOT_FOUND_ERROR: "NEXT_NOT_FOUND",
  mockRedirect: vi.fn(),
  mockRequireOrgContext: vi.fn(),
  mockGetCreditBatchById: vi.fn(),
  mockGetSupplierById: vi.fn(),
  mockGetCustomerById: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error(NOT_FOUND_ERROR);
  },
  redirect: mockRedirect,
}));
vi.mock("@/lib/auth/server", () => ({
  requireOrgContext: mockRequireOrgContext,
}));
vi.mock("@/data-access/credit-batches", () => ({
  getCreditBatchById: mockGetCreditBatchById,
}));
vi.mock("@/data-access/entities/suppliers", () => ({
  getSupplierById: mockGetSupplierById,
}));
vi.mock("@/components/suppliers", () => ({ SupplierDetail: () => null }));
vi.mock("@/data-access/entities/customers", () => ({
  getCustomerById: mockGetCustomerById,
}));
vi.mock("@/components/customers", () => ({ CustomerDetail: () => null }));

import CreditBatchRedirectPage from "@/app/(app)/credit-batches/[id]/page";
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
    mockGetCreditBatchById.mockResolvedValue({
      id: VALID_MISSING_ID,
      facilityId: "facility-1",
    });
  });

  it("redirects the retired credit-batch detail route into the list side sheet", async () => {
    await CreditBatchRedirectPage({
      params: Promise.resolve({ id: VALID_MISSING_ID }),
      searchParams: Promise.resolve({ facility: "facility-1" }),
    });

    expect(mockRedirect).toHaveBeenCalledWith(
      `/credit-batches?facility=facility-1&batch=${VALID_MISSING_ID}`,
    );
  });

  it("drops a stale batch param when redirecting the credit-batch detail route", async () => {
    await CreditBatchRedirectPage({
      params: Promise.resolve({ id: VALID_MISSING_ID }),
      searchParams: Promise.resolve({ batch: "stale-id" }),
    });

    expect(mockRedirect).toHaveBeenCalledWith(
      `/credit-batches?facility=facility-1&batch=${VALID_MISSING_ID}`,
    );
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
