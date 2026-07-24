import { describe, expect, it } from "vitest";
import { getEntityOptionCodeLabel } from "./option-display";

describe("getEntityOptionCodeLabel", () => {
  it("suppresses a code that duplicates the option name", () => {
    expect(
      getEntityOptionCodeLabel({
        id: "batch-1",
        code: "CB-26-001",
        name: "CB-26-001",
      }),
    ).toBeUndefined();
  });

  it("keeps a distinct code that disambiguates a named option", () => {
    expect(
      getEntityOptionCodeLabel({
        id: "reactor-1",
        code: "RE-001",
        name: "North Kiln",
      }),
    ).toBe("RE-001");
  });
});
