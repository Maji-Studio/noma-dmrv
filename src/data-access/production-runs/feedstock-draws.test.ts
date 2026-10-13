import { describe, expect, it, vi } from "vitest";
import { SafeError } from "@/lib/errors";
import { MASS_INPUT_MAX_KG } from "@/schemas/helpers";
import {
  normalizeProductionRunFeedstockDraws,
  sumProductionRunFeedstockDraws,
  validateProductionRunFeedstockDrawSources,
} from "./feedstock-draws";

import type { DbTransaction } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
vi.mock("@/db", () => ({ db: {} }));

const BIN_A = "11111111-1111-4111-8111-111111111111";
const BIN_B = "22222222-2222-4222-8222-222222222222";

describe("production-run feedstock draw boundary", () => {
  it("preserves submitted draw order and sums storage precision exactly", () => {
    const draws = normalizeProductionRunFeedstockDraws([
      { storageLocationId: BIN_B, wetMassKg: 0.002 },
      { storageLocationId: BIN_A, wetMassKg: 0.001 },
    ]);

    expect(draws.map((draw) => draw.storageLocationId)).toEqual([BIN_B, BIN_A]);
    expect(sumProductionRunFeedstockDraws(draws)).toBe(0.003);
  });

  it("rejects duplicate bins and excess decimal precision", () => {
    expect(() =>
      normalizeProductionRunFeedstockDraws([
        { storageLocationId: BIN_A, wetMassKg: 1 },
        { storageLocationId: BIN_A, wetMassKg: 2 },
      ]),
    ).toThrow(SafeError);
    expect(() =>
      normalizeProductionRunFeedstockDraws([
        { storageLocationId: BIN_A, wetMassKg: 0.0001 },
      ]),
    ).toThrow(/3 decimal places/);
  });

  it("rejects a combined wet mass above the stored maximum", () => {
    expect(() =>
      normalizeProductionRunFeedstockDraws([
        { storageLocationId: BIN_A, wetMassKg: MASS_INPUT_MAX_KG },
        { storageLocationId: BIN_B, wetMassKg: 0.001 },
      ]),
    ).toThrow(/Total feedstock wet mass is too large/);
  });
});

it("points missing lower-id draws at their submitted index after repeated normalization", async () => {
  const ctx = { organizationId: "org-test", userId: "user-test", orgRole: "owner", isPlatformAdmin: false } satisfies OrgContext;
  const tx = { select: () => ({ from: () => ({ leftJoin: () => ({ where: async () => [
    { id: BIN_B, facilityId: "facility", type: "feedstock_bin", feedstockTypeId: "type", feedstockTypeUsage: "pyrolysis" },
  ] }) }) }) } as unknown as DbTransaction;
  const draws = normalizeProductionRunFeedstockDraws(normalizeProductionRunFeedstockDraws([
    { storageLocationId: BIN_B, wetMassKg: 1 }, { storageLocationId: BIN_A, wetMassKg: 1 },
  ]));
  await expect(validateProductionRunFeedstockDrawSources(ctx, tx, draws, "facility")).rejects.toMatchObject({
    code: "not_found", issues: [{ path: ["feedstockDraws", 1, "storageLocationId"] }],
  });
});
