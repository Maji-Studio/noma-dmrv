import { describe, expect, it } from "vitest";
import { SafeError } from "@/lib/errors";
import { MASS_INPUT_MAX_KG } from "@/schemas/helpers";
import {
  normalizeProductionRunFeedstockDraws,
  sumProductionRunFeedstockDraws,
} from "./feedstock-draws";

const BIN_A = "11111111-1111-4111-8111-111111111111";
const BIN_B = "22222222-2222-4222-8222-222222222222";

describe("production-run feedstock draw boundary", () => {
  it("sorts canonical draws and sums storage precision exactly", () => {
    const draws = normalizeProductionRunFeedstockDraws([
      { storageLocationId: BIN_B, wetMassKg: 0.002 },
      { storageLocationId: BIN_A, wetMassKg: 0.001 },
    ]);

    expect(draws.map((draw) => draw.storageLocationId)).toEqual([BIN_A, BIN_B]);
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
