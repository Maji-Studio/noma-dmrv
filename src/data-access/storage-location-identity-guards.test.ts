import { beforeEach, describe, expect, it, vi } from "vitest";
import { DomainError } from "@/lib/domain-errors";
import type { DbTransaction } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import type { StorageLocationType } from "@/schemas/storage-locations";

const mocks = vi.hoisted(() => ({ availableKg: vi.fn(), references: vi.fn(), hasReferences: vi.fn() }));
vi.mock("./bin-stock-guards", () => ({
  deriveBinLaneAvailableKg: mocks.availableKg,
  hasNonZeroStock: (kg: number) => kg !== 0,
}));
vi.mock("./storage-location-references", () => ({
  countStorageLocationReferences: mocks.references,
  hasStorageLocationReferences: mocks.hasReferences,
}));
import { assertBinIdentityChangeAllowed } from "./storage-location-identity-guards";

const ctx = { organizationId: "org", userId: "user" } as OrgContext;
const tx = {} as DbTransaction;
type Identity = { type: StorageLocationType; feedstockTypeId: string; facilityId: string };
const bin: Identity & { id: string } = { id: "bin", type: "feedstock_bin", feedstockTypeId: "ft-1", facilityId: "fac-1" };

async function refusal(next: Partial<Identity>): Promise<DomainError> {
  try {
    await assertBinIdentityChangeAllowed(ctx, tx, bin, { ...bin, ...next });
  } catch (error) {
    return error as DomainError;
  }
  throw new Error("expected a refusal");
}

beforeEach(() => {
  mocks.availableKg.mockReset().mockResolvedValue(0);
  mocks.references.mockReset().mockResolvedValue({});
  mocks.hasReferences.mockReset().mockReturnValue(false);
});

describe("assertBinIdentityChangeAllowed refusal issues", () => {
  it.each<[string, Partial<Identity>, string]>([
    ["type", { type: "biochar_bin" }, "Storage type"],
    ["feedstockTypeId", { feedstockTypeId: "ft-2" }, "Feedstock type"],
    ["facilityId", { facilityId: "fac-2" }, "Facility"],
  ])("names the %s form field when stock blocks the change", async (key, next, label) => {
    mocks.availableKg.mockResolvedValue(12);
    const error = await refusal(next);
    expect(error.code).toBe("certification_locked");
    expect(error.message).toContain(`before changing ${label}.`);
    expect(error.issues).toEqual([{ path: [key], code: "certification_locked", message: error.message }]);
  });

  it("names the field when only stock history blocks the change", async () => {
    mocks.hasReferences.mockReturnValue(true);
    const error = await refusal({ type: "product_bin" });
    expect(error.code).toBe("certification_locked");
    expect(error.message).toContain("This bin has stock history.");
    expect(error.issues).toEqual([{ path: ["type"], code: "certification_locked", message: error.message }]);
  });

  it("names the type, not the feedstock type it clears, when both move", async () => {
    mocks.availableKg.mockResolvedValue(3);
    const error = await refusal({ type: "biochar_bin", feedstockTypeId: "ft-2" });
    expect(error.issues.map((issue) => issue.path)).toEqual([["type"]]);
  });
});
