import { beforeEach, describe, expect, it, vi } from "vitest";
import { DomainError } from "@/lib/domain-errors";
import { SafeError } from "@/lib/errors";
import CreditBatchRoute from "./page";

const mocks = vi.hoisted(() => ({
  facility: vi.fn(),
  notFound: vi.fn(() => { throw new Error("route-not-found"); }),
}));
const BATCH_ID = "12345678-1234-4234-8234-123456789abc";

vi.mock("next/navigation", () => ({ notFound: mocks.notFound, redirect: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ requireOrgContext: vi.fn(async () => ({ orgRole: "admin", isPlatformAdmin: false })) }));
vi.mock("@/data-access/credit-batches", () => ({ getCreditBatchById: vi.fn(async () => ({ id: "batch", facilityId: "own-facility" })) }));
vi.mock("@/data-access/facilities", () => ({ getFacilityById: mocks.facility }));
vi.mock("@/lib/react-query/server-hydration", () => ({ createServerHydrationState: vi.fn(() => ({})) }));
vi.mock("@/components/credit-batches", () => ({ CreditBatchPage: vi.fn(() => null) }));

function route() {
  return CreditBatchRoute({ params: Promise.resolve({ id: BATCH_ID }), searchParams: Promise.resolve({ facility: "another-facility" }) });
}

beforeEach(() => vi.clearAllMocks());

describe("credit batch facility mismatch", () => {
  it("opens an archived facility's batch", async () => {
    mocks.facility.mockResolvedValue({ archivedAt: new Date("2026-10-01") });
    await expect(route()).resolves.toBeDefined();
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it("returns not-found for an active facility", async () => {
    mocks.facility.mockResolvedValue({ archivedAt: null });
    await expect(route()).rejects.toThrow("route-not-found");
  });

  it("returns not-found only for a typed missing facility", async () => {
    mocks.facility.mockRejectedValue(new DomainError("not_found", "Facility not found"));
    await expect(route()).rejects.toThrow("route-not-found");
  });

  it.each([
    new Error("Database timeout"),
    new SafeError("Facility not found"),
    new DomainError("forbidden", "Access denied"),
  ])("propagates other failures to the error boundary: $message", async (error) => {
    mocks.facility.mockRejectedValue(error);
    await expect(route()).rejects.toBe(error);
    expect(mocks.notFound).not.toHaveBeenCalled();
  });
});
