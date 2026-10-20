import { describe, expect, it } from "vitest";
import { compositionMassOrNothing, formatCompositionMass } from "./composition-ledger";

describe("composition ledger mass precision", () => {
  it("distinguishes small positive quantities from actual zero", () => {
    expect(formatCompositionMass(0.001)).toBe("<0.1 kg");
    expect(formatCompositionMass(0)).toBe("0 kg");
    expect(formatCompositionMass(0.1)).toBe("0.1 kg");
  });

  it.each([null, undefined, Number.NaN, Infinity, -1])("leaves out invalid mass %s instead of a placeholder", mass => {
    expect(compositionMassOrNothing(mass)).toBeNull();
  });
});
