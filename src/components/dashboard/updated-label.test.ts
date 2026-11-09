import { describe, expect, it } from "vitest";
import { updatedLabel } from "./updated-label";

const ZONE = "Africa/Dar_es_Salaam";
const NOW = new Date("2026-11-09T14:00:00Z");

describe("updatedLabel", () => {
  it("shows the time alone for today", () => {
    expect(updatedLabel("2026-11-09T13:31:00Z", ZONE, NOW)).toBe("Updated 16:31");
  });

  it("adds the day for another day", () => {
    expect(updatedLabel("2026-11-08T13:31:00Z", ZONE, NOW)).toBe("Updated Nov 8, 16:31");
  });
});
