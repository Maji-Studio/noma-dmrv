import { describe, expect, it } from "vitest";
import { formatProductionRunOverlapMessage } from "./overlap-conflict";

const EN_OR_EM_DASH = /[\u2013\u2014]/;

describe("formatProductionRunOverlapMessage", () => {
  it.each([
    { facilityTimezone: "Africa/Dar_es_Salaam", start: "2026-07-25T22:30:00Z", end: "2026-07-25T23:30:00Z", window: "2026-07-26 01:30 to 02:30" },
    { facilityTimezone: "America/Los_Angeles", start: "2026-07-26T02:30:00Z", end: "2026-07-26T03:30:00Z", window: "2026-07-25 19:30 to 20:30" },
    { facilityTimezone: "Africa/Dar_es_Salaam", start: "2026-07-25T20:30:00Z", end: "2026-07-25T22:30:00Z", window: "2026-07-25 23:30 to 2026-07-26 01:30" },
    { facilityTimezone: "America/Los_Angeles", start: "2026-07-26T06:30:00Z", end: "2026-07-26T07:30:00Z", window: "2026-07-25 23:30 to 2026-07-26 00:30" },
  ])("prints local dates and times in $facilityTimezone ($window)", ({ facilityTimezone, start, end, window }) => {
    const message = formatProductionRunOverlapMessage({
      code: "PR-1", startTime: new Date(start), endTime: new Date(end), facilityTimezone,
    });
    expect(message).toBe(`Overlaps run PR-1 (${window}) on this reactor`);
    expect(message).not.toMatch(EN_OR_EM_DASH);
  });

  it("keeps the unfinished-run instruction", () => {
    expect(formatProductionRunOverlapMessage({
      code: "PR-1", startTime: new Date("2026-07-25T22:30:00Z"), endTime: null,
      facilityTimezone: "Africa/Dar_es_Salaam",
    })).toBe("Production run PR-1 on this reactor is unfinished. Set its end time before adding another run.");
  });
});
