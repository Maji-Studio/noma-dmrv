import { describe, expect, it } from "vitest";
import { facilityToday, toDateInputValue } from "./date-utils";

const TIME_ZONE = "Africa/Dar_es_Salaam";
const NOW = new Date("2026-10-21T22:00:00Z");

describe("facility date input defaults", () => {
  it("resolves today on the facility calendar independently of the browser", () => {
    expect(facilityToday(TIME_ZONE, NOW)).toBe("2026-10-22");
    expect(facilityToday("America/Los_Angeles", NOW)).toBe("2026-10-21");
  });

  it.each([undefined, null, "", "invalid", new Date(NaN)])("uses the caller's facility day for %s", (value) => {
    expect(toDateInputValue(value, facilityToday(TIME_ZONE, NOW))).toBe("2026-10-22");
  });

  it("preserves persisted date-only values on the UTC calendar", () => {
    const today = facilityToday(TIME_ZONE, NOW);
    expect(toDateInputValue("2026-10-21", today)).toBe("2026-10-21");
    expect(toDateInputValue(new Date("2026-10-21T00:00:00Z"), today)).toBe("2026-10-21");
  });
});
