import { describe, expect, it } from "vitest";
import { resolveRunWindow } from "./run-window";

const TIME_ZONE = "Africa/Dar_es_Salaam";
const VALUES = {
  startDate: "2026-10-18",
  startTime: "08:00",
  endDate: "",
  endTime: "17:00",
};

describe("resolveRunWindow", () => {
  it.each(["", undefined, null])("defaults an empty end date (%s) to the start date", (endDate) => {
    expect(resolveRunWindow({ ...VALUES, endDate }, TIME_ZONE)).toEqual({
      start: new Date("2026-10-18T05:00:00.000Z"),
      end: new Date("2026-10-18T14:00:00.000Z"),
      startError: null,
      endError: null,
    });
  });

  it("uses an explicit next-day end date for an overnight run", () => {
    const window = resolveRunWindow({ ...VALUES, startTime: "22:00", endDate: "2026-10-19", endTime: "06:00" }, TIME_ZONE);
    expect(window.start).toEqual(new Date("2026-10-18T19:00:00.000Z"));
    expect(window.end).toEqual(new Date("2026-10-19T03:00:00.000Z"));
  });

  it("keeps an earlier end time on the start date without rolling overnight", () => {
    const window = resolveRunWindow({ ...VALUES, endTime: "07:00" }, TIME_ZONE);
    expect(window.end).toEqual(new Date("2026-10-18T04:00:00.000Z"));
    expect(window.endError).toBeNull();
  });

  it.each([
    ["2026-03-08", "02:30", "does not exist"],
    ["2026-11-01", "01:30", "occurs twice"],
  ])("refuses the DST wall clock %s %s on both fields", (date, time, message) => {
    const window = resolveRunWindow({ startDate: date, startTime: time, endDate: "", endTime: time }, "America/New_York");
    expect(window.start).toBeNull();
    expect(window.end).toBeNull();
    expect(window.startError).toContain(`${time} ${message} on ${date} in America/New York`);
    expect(window.endError).toBe(window.startError);
  });

  it("passes valid Date times through unchanged even without dates", () => {
    const start = new Date("2026-10-18T05:00:00.000Z");
    const end = new Date("2026-10-18T14:00:00.000Z");
    const window = resolveRunWindow({ startDate: undefined, startTime: start, endDate: undefined, endTime: end }, TIME_ZONE);
    expect(window.start).toBe(start);
    expect(window.end).toBe(end);
  });

  it("reads Date calendar values on the local calendar and resolves the end independently of the start time", () => {
    const window = resolveRunWindow({ ...VALUES, startDate: new Date(2026, 9, 18), startTime: "" }, TIME_ZONE);
    expect(window.start).toBeNull();
    expect(window.end).toEqual(new Date("2026-10-18T14:00:00.000Z"));
  });

  it.each(["", undefined, null, "8:00", "24:00", "12:60", "not-a-time", new Date(NaN), 123])(
    "leaves empty or malformed time %s unresolved",
    (time) => {
      expect(resolveRunWindow({ ...VALUES, startTime: time, endTime: time }, TIME_ZONE)).toEqual({
        start: null, end: null, startError: null, endError: null,
      });
    },
  );

  it.each(["", undefined, null, "2026-2-03", "2026-02-30", "2026-13-01", "not-a-date", new Date(NaN), 123])(
    "leaves empty or malformed date %s unresolved",
    (date) => {
      expect(resolveRunWindow({ ...VALUES, startDate: date, endDate: date }, TIME_ZONE)).toEqual({
        start: null, end: null, startError: null, endError: null,
      });
    },
  );

  it("does not default a malformed explicit end date", () => {
    const window = resolveRunWindow({ ...VALUES, endDate: "bad-date" }, TIME_ZONE);
    expect(window.start).toEqual(new Date("2026-10-18T05:00:00.000Z"));
    expect(window.end).toBeNull();
  });

  it("rethrows failures other than DST refusals", () => {
    expect(() => resolveRunWindow(VALUES, "invalid-zone")).toThrow(RangeError);
  });
});
