import { describe, expect, it } from "vitest";
import { formatCompositionMass } from "./composition-ledger";

describe("composition ledger mass precision", () => {
  it("distinguishes small positive quantities from actual zero", () => {
    expect(formatCompositionMass(0.001)).toBe("<0.1 kg");
    expect(formatCompositionMass(0)).toBe("0 kg");
    expect(formatCompositionMass(0.1)).toBe("0.1 kg");
  });

  it.each([null, undefined, Number.NaN, Infinity, -1])("does not format invalid mass %s as a quantity", mass => {
    expect(formatCompositionMass(mass)).toBe("Not available");
  });
});
