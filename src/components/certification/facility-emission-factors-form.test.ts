import { describe, expect, it } from "vitest";
import { factorsFormKey } from "./facility-emission-factors-form";

describe("factorsFormKey", () => {
  it("changes between two saved versions within the same second", () => {
    const cached = factorsFormKey("facility", { updatedAt: new Date("2026-10-01T10:00:00.120Z") });
    const refreshed = factorsFormKey("facility", { updatedAt: new Date("2026-10-01T10:00:00.870Z") });
    expect(cached).not.toBe(refreshed);
  });

  it("keys a facility without saved factors as new", () => {
    expect(factorsFormKey("facility", null)).toBe("facility:new");
  });
});
