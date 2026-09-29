import { describe, expect, it } from "vitest";
import { eventTimeFromInput, eventTimeInputValue } from "./event-time-input";

const DAR = "Africa/Dar_es_Salaam";
const NEW_YORK = "America/New_York";

describe("event time picker conversion", () => {
  it("reads and writes the facility wall clock, whatever the viewer's zone", () => {
    expect(eventTimeFromInput("2026-09-15T14:30", DAR)).toBe("2026-09-15T11:30:00.000Z");
    expect(eventTimeInputValue("2026-09-15T11:30:00.000Z", DAR)).toBe("2026-09-15T14:30");
  });
  it("shows an untouched instant to the minute while the value keeps its seconds", () => {
    const withSeconds = "2026-09-15T11:30:42.123Z";
    expect(eventTimeInputValue(withSeconds, DAR)).toBe("2026-09-15T14:30");
  });
  it("rounds a picked time to the minute on the facility clock", () => {
    const picked = eventTimeFromInput(eventTimeInputValue("2026-09-15T11:30:42.123Z", DAR), DAR);
    expect(picked).toBe("2026-09-15T11:30:00.000Z");
  });
  it.each(["", "2026-09-15", "2026-09-15T14", "not a time", "2026-02-30T10:00"])("leaves %j empty for the schema to report", value => {
    expect(eventTimeFromInput(value, DAR)).toBe("");
  });
  it("refuses a wall clock skipped or repeated by daylight saving instead of shifting it", () => {
    expect(eventTimeFromInput("2026-03-08T02:30", NEW_YORK)).toBe("");
    expect(eventTimeFromInput("2026-11-01T01:30", NEW_YORK)).toBe("");
    expect(eventTimeFromInput("2026-03-08T03:30", NEW_YORK)).toBe("2026-03-08T07:30:00.000Z");
  });
  it.each([undefined, null, "", "garbage", 42])("shows %j as an empty picker", value => {
    expect(eventTimeInputValue(value, DAR)).toBe("");
  });
});
