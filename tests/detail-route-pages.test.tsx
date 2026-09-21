import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  NOT_FOUND_ERROR,
  mockRedirect,
  mockRequireOrgContext,
  mockGetCreditBatchById,
  mockFindSupplierDetail,
  mockFindCustomerWithRelations,
} = vi.hoisted(() => ({
  NOT_FOUND_ERROR: "NEXT_NOT_FOUND",
  mockRedirect: vi.fn(),
  mockRequireOrgContext: vi.fn(),
  mockGetCreditBatchById: vi.fn(),
  mockFindSupplierDetail: vi.fn(),
  mockFindCustomerWithRelations: vi.fn(),
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
vi.mock("@/data-access/supplier-detail", () => ({
  findSupplierDetail: mockFindSupplierDetail,
}));
vi.mock("@/components/suppliers", () => ({ SupplierDetail: () => null }));
vi.mock("@/data-access/customer-detail", () => ({
  findCustomerWithRelations: mockFindCustomerWithRelations,
}));
vi.mock("@/components/customers", () => ({ CustomerDetail: () => null }));

import CreditBatchRedirectPage from "@/app/(app)/credit-batches/[id]/page";
import SupplierDetailPage from "@/app/(app)/suppliers/[supplierId]/page";
import CustomerDetailPage from "@/app/(app)/customers/[customerId]/page";

const VALID_MISSING_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_VALID_ID = "22222222-2222-4222-8222-222222222222";

function dehydratedData(
  page: Awaited<ReturnType<typeof SupplierDetailPage>>,
  queryKey: readonly unknown[],
) {
  const state = page.props.state as {
    queries: Array<{
      queryKey: readonly unknown[];
      state: { data: unknown; dataUpdatedAt: number };
    }>;
  };
  return state.queries.find(
    (query) => JSON.stringify(query.queryKey) === JSON.stringify(queryKey),
  )?.state;
}

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
    mockFindSupplierDetail.mockResolvedValue({
      supplier: {
        id: VALID_MISSING_ID,
        code: "SUP-001",
        name: "Supplier One",
        contactEmail: "supplier@example.test",
      },
      locations: [{ id: "supplier-location-1", country: "Switzerland" }],
    });
    mockFindCustomerWithRelations.mockResolvedValue({
      id: VALID_MISSING_ID,
      code: "CUS-001",
      name: "Customer One",
      locations: [{ id: "customer-location-1", country: "Switzerland" }],
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
    expect(mockFindSupplierDetail).not.toHaveBeenCalled();
  });

  it("returns not found for a malformed customer ID before querying", async () => {
    await expect(
      CustomerDetailPage({
        params: Promise.resolve({ customerId: "__missing__" }),
      }),
    ).rejects.toThrow(NOT_FOUND_ERROR);

    expect(mockRequireOrgContext).not.toHaveBeenCalled();
    expect(mockFindCustomerWithRelations).not.toHaveBeenCalled();
  });

  it("returns not found for an absent supplier UUID", async () => {
    mockFindSupplierDetail.mockResolvedValue(null);

    await expect(
      SupplierDetailPage({
        params: Promise.resolve({ supplierId: VALID_MISSING_ID }),
      }),
    ).rejects.toThrow(NOT_FOUND_ERROR);

    expect(mockFindSupplierDetail).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "test-org" }),
      VALID_MISSING_ID,
    );
  });

  it("returns not found for an absent customer UUID", async () => {
    mockFindCustomerWithRelations.mockResolvedValue(null);

    await expect(
      CustomerDetailPage({
        params: Promise.resolve({ customerId: VALID_MISSING_ID }),
      }),
    ).rejects.toThrow(NOT_FOUND_ERROR);

    expect(mockFindCustomerWithRelations).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "test-org" }),
      VALID_MISSING_ID,
    );
  });

  it("hydrates complete supplier detail and locations under their exact keys", async () => {
    const page = await SupplierDetailPage({
      params: Promise.resolve({ supplierId: VALID_MISSING_ID }),
    });

    const supplierState = dehydratedData(page, [
      "suppliers",
      "detail",
      VALID_MISSING_ID,
    ]);
    const locationsState = dehydratedData(page, [
      "suppliers",
      "supplierLocations",
      VALID_MISSING_ID,
    ]);

    expect(supplierState?.data).toEqual(
      expect.objectContaining({
        id: VALID_MISSING_ID,
        contactEmail: "supplier@example.test",
      }),
    );
    expect(locationsState?.data).toEqual([
      expect.objectContaining({ id: "supplier-location-1" }),
    ]);
    expect(supplierState?.dataUpdatedAt).toBeGreaterThan(0);
    expect(locationsState?.dataUpdatedAt).toBe(supplierState?.dataUpdatedAt);
    expect(mockFindSupplierDetail).toHaveBeenCalledTimes(1);
  });

  it("hydrates complete customer relations under the detail key", async () => {
    const page = await CustomerDetailPage({
      params: Promise.resolve({ customerId: VALID_MISSING_ID }),
    });

    const customerState = dehydratedData(page, [
      "customers",
      "detail",
      VALID_MISSING_ID,
      "relations",
    ]);

    expect(customerState?.data).toEqual(
      expect.objectContaining({
        id: VALID_MISSING_ID,
        locations: [expect.objectContaining({ id: "customer-location-1" })],
      }),
    );
    expect(customerState?.dataUpdatedAt).toBeGreaterThan(0);
    expect(mockFindCustomerWithRelations).toHaveBeenCalledTimes(1);
  });

  it("keeps hydration cache entries isolated by detail ID", async () => {
    mockFindSupplierDetail.mockResolvedValueOnce({
      supplier: { id: SECOND_VALID_ID, code: "SUP-002", name: "Supplier Two" },
      locations: [],
    });

    const page = await SupplierDetailPage({
      params: Promise.resolve({ supplierId: SECOND_VALID_ID }),
    });

    expect(
      dehydratedData(page, ["suppliers", "detail", SECOND_VALID_ID])?.data,
    ).toEqual(expect.objectContaining({ id: SECOND_VALID_ID }));
    expect(
      dehydratedData(page, ["suppliers", "detail", VALID_MISSING_ID]),
    ).toBeUndefined();
  });
});
