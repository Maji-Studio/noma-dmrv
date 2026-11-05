import { afterEach, describe, expect, it, vi } from "vitest";
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
  const ctx = { organizationId: "org-test", userId: "user-test", orgRole: "admin", isPlatformAdmin: false } satisfies OrgContext;
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

afterEach(() => vi.unstubAllEnvs());

describe("multi-bin switch off", () => {
  const draws = [{ storageLocationId: BIN_A, wetMassKg: 1 }, { storageLocationId: BIN_B, wetMassKg: 2 }];
  it("refuses new multi-bin runs with a feedstockDraws field error", () => {
    vi.stubEnv("MULTI_BIN_RUNS_ENABLED", "false");
    expect(() => normalizeProductionRunFeedstockDraws(draws)).toThrow(expect.objectContaining({
      code: "validation_failed", issues: [{ path: ["feedstockDraws"], code: "validation_failed",
        message: "Runs take feedstock from one bin. Several source bins are turned off on this server." }],
    }));
    expect(normalizeProductionRunFeedstockDraws(draws.slice(0, 1))).toEqual(draws.slice(0, 1));
    expect(normalizeProductionRunFeedstockDraws([])).toEqual([]);
  });
  it("allows older runs to keep bins, change masses, reorder and remove bins", () => {
    vi.stubEnv("MULTI_BIN_RUNS_ENABLED", "false");
    const changed = [...draws].reverse().map(draw => ({ ...draw, wetMassKg: 3 }));
    expect(normalizeProductionRunFeedstockDraws(changed, [BIN_A, BIN_B])).toEqual(changed);
    expect(normalizeProductionRunFeedstockDraws([draws[0]], [BIN_A, BIN_B])).toEqual([draws[0]]);
    expect(normalizeProductionRunFeedstockDraws([], [BIN_A, BIN_B])).toEqual([]);
  });
  it("refuses adding a bin to an older run when several bins result", () => {
    vi.stubEnv("MULTI_BIN_RUNS_ENABLED", "false");
    expect(() => normalizeProductionRunFeedstockDraws(draws, [BIN_A])).toThrow(/Several source bins/);
    expect(normalizeProductionRunFeedstockDraws([draws[1]], [BIN_A])).toEqual([draws[1]]);
  });
});
