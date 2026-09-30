import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  NOT_FOUND_ERROR,
  mockRedirect,
  mockRequireOrgContext,
  mockGetCreditBatchById,
} = vi.hoisted(() => ({
  NOT_FOUND_ERROR: "NEXT_NOT_FOUND",
  mockRedirect: vi.fn(),
  mockRequireOrgContext: vi.fn(),
  mockGetCreditBatchById: vi.fn(),
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

import CreditBatchRedirectPage from "@/app/(app)/credit-batches/[id]/page";

const VALID_MISSING_ID = "11111111-1111-4111-8111-111111111111";

describe("credit batch detail route redirect", () => {
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
});
