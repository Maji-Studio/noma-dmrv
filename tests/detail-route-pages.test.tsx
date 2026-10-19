import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  NOT_FOUND_ERROR,
  REDIRECT_ERROR,
  mockRedirect,
  mockRequireOrgContext,
  mockGetCreditBatchById,
} = vi.hoisted(() => ({
  NOT_FOUND_ERROR: "NEXT_NOT_FOUND",
  REDIRECT_ERROR: "NEXT_REDIRECT",
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

import CreditBatchRoute from "@/app/(app)/credit-batches/[id]/page";

const BATCH_ID = "11111111-1111-4111-8111-111111111111";

describe("credit batch page route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Next's redirect never returns; the route must stop where it is called.
    mockRedirect.mockImplementation(() => {
      throw new Error(REDIRECT_ERROR);
    });
    mockRequireOrgContext.mockResolvedValue({
      userId: "test-user",
      organizationId: "test-org",
    });
    mockGetCreditBatchById.mockResolvedValue({
      id: BATCH_ID,
      facilityId: "facility-1",
    });
  });

  it("adds the batch's facility to a link without one and keeps the other params", async () => {
    await expect(
      CreditBatchRoute({
        params: Promise.resolve({ id: BATCH_ID }),
        searchParams: Promise.resolve({ tab: "samples" }),
      }),
    ).rejects.toThrow(REDIRECT_ERROR);

    expect(mockRedirect).toHaveBeenCalledWith(`/credit-batches/${BATCH_ID}?tab=samples&facility=facility-1`);
  });

  it("is a not-found when the facility param names another facility", async () => {
    await expect(
      CreditBatchRoute({
        params: Promise.resolve({ id: BATCH_ID }),
        searchParams: Promise.resolve({ facility: "facility-2" }),
      }),
    ).rejects.toThrow(NOT_FOUND_ERROR);
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("is a not-found when the org-scoped read finds no batch", async () => {
    mockGetCreditBatchById.mockResolvedValue(undefined);

    await expect(
      CreditBatchRoute({
        params: Promise.resolve({ id: BATCH_ID }),
        searchParams: Promise.resolve({ facility: "facility-1" }),
      }),
    ).rejects.toThrow(NOT_FOUND_ERROR);
  });
});
