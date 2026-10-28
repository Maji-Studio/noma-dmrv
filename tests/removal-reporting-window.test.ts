/**
 * Unit tests for the removal reporting-window guards (issue #320).
 *
 * `assertReportingWindowNotInverted` must compare each application against
 * ITS OWN lineage's production-run start — a removal-wide earliest start
 * would let a mixed removal hide a lineage whose application predates its
 * own run behind an earlier sibling run (PR #336 second-pass review).
 */
import { describe, expect, it } from "vitest";
import {
  assertRemovalDatesNotFuture,
  assertReportingWindowNotInverted,
  resolveRemovalReportingWindow,
  resolveLatestApplicationTime,
} from "@/fn/certification/removal-reporting-window";

const RUN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RUN_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EN_OR_EM_DASH = /[\u2013\u2014]/;

function thrownMessage(action: () => void): string {
  try {
    action();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("Expected action to throw");
}

function lineage(
  applicationDate: string,
  appCode: string,
  runId: string | null,
  runCode = "RUN",
) {
  return {
    application: { applicationDate: new Date(applicationDate), code: appCode },
    productionRun: runId ? { id: runId, code: runCode } : null,
  };
}

describe("assertReportingWindowNotInverted", () => {
  const runStarts = new Map<string, Date>([
    [RUN_A, new Date("2026-01-01T08:00:00Z")],
    [RUN_B, new Date("2026-03-01T08:00:00Z")],
  ]);

  it("passes when every application is on/after its own run's start date", () => {
    expect(() =>
      assertReportingWindowNotInverted({
        lineages: [
          lineage("2026-02-01T00:00:00Z", "APP-A", RUN_A, "RUN-A"),
          lineage("2026-04-01T00:00:00Z", "APP-B", RUN_B, "RUN-B"),
        ],
        runStartTimeByRunId: runStarts,
        facilityTimezone: "UTC",
      }),
    ).not.toThrow();
  });

  it("blocks a mixed removal whose application predates its OWN run even when an earlier sibling run exists", () => {
    // Run A starts Jan 1, run B starts Mar 1; B's application is dated Feb 1.
    // Feb 1 is after the removal-wide earliest start (Jan 1), so an
    // earliest-start comparison would wrongly pass this inverted lineage.
    expect(() =>
      assertReportingWindowNotInverted({
        lineages: [
          lineage("2026-01-15T00:00:00Z", "APP-A", RUN_A, "RUN-A"),
          lineage("2026-02-01T00:00:00Z", "APP-B", RUN_B, "RUN-B"),
        ],
        runStartTimeByRunId: runStarts,
        facilityTimezone: "UTC",
      }),
    ).toThrow(
      /APP-B is dated 2026-02-01, before its production run RUN-B started 2026-03-01/,
    );
  });

  it("passes a same-UTC-day application against a mid-day run start (date granularity, issue #320 caveat 4)", () => {
    expect(() =>
      assertReportingWindowNotInverted({
        lineages: [lineage("2026-01-01T00:00:00Z", "APP-A", RUN_A)],
        runStartTimeByRunId: runStarts,
        facilityTimezone: "UTC",
      }),
    ).not.toThrow();
  });

  it.each([
    { zone: "Africa/Dar_es_Salaam", start: "2026-07-25T22:30:00Z", day: "2026-07-26", previous: "2026-07-25" },
    { zone: "America/Los_Angeles", start: "2026-07-26T02:30:00Z", day: "2026-07-25", previous: "2026-07-24" },
  ])("compares business dates with the run's local day in $zone", ({ zone, start, day, previous }) => {
    const runStartTimeByRunId = new Map([[RUN_A, new Date(start)]]);
    const check = (applicationDay: string) => assertReportingWindowNotInverted({
      lineages: [lineage(`${applicationDay}T00:00:00Z`, "APP-A", RUN_A, "RUN-A")],
      runStartTimeByRunId,
      facilityTimezone: zone,
    });
    expect(() => check(day)).not.toThrow();
    const message = thrownMessage(() => check(previous));
    expect(message).toBe(
      `Application APP-A is dated ${previous}, before its production run RUN-A started ${day}. ` +
        "Correct the application date before submitting.",
    );
    expect(message).not.toMatch(EN_OR_EM_DASH);
  });

  it("fails closed when a lineage has no production run", () => {
    expect(() =>
      assertReportingWindowNotInverted({
        lineages: [lineage("2026-02-01T00:00:00Z", "APP-X", null)],
        runStartTimeByRunId: runStarts,
        facilityTimezone: "UTC",
      }),
    ).toThrow(/APP-X.*no resolvable production run start/);
  });

  it("fails closed when a lineage's run start is missing from the map", () => {
    expect(() =>
      assertReportingWindowNotInverted({
        lineages: [
          lineage(
            "2026-02-01T00:00:00Z",
            "APP-Y",
            "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          ),
        ],
        runStartTimeByRunId: runStarts,
        facilityTimezone: "UTC",
      }),
    ).toThrow(/APP-Y.*no resolvable production run start/);
  });
});

describe("resolveLatestApplicationTime", () => {
  it("returns the latest application date across lineages", () => {
    const latest = resolveLatestApplicationTime([
      lineage("2026-02-01T00:00:00Z", "APP-A", RUN_A),
      lineage("2026-04-01T00:00:00Z", "APP-B", RUN_B),
      lineage("2026-03-01T00:00:00Z", "APP-C", RUN_B),
    ]);
    expect(latest.toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });

  it("fails closed on an empty lineage list", () => {
    expect(() => resolveLatestApplicationTime([])).toThrow(
      /This Removal has no applications/,
    );
  });
});

describe("resolveRemovalReportingWindow", () => {
  // Production instants convert to the facility's calendar day. Application
  // dates are already calendar dates (UTC midnight), so they pass through.
  // Both returned values are calendar dates at UTC midnight (issue #1282).
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

  it("does not refuse a Bogota run ending 14 Mar 21:30 local with an application dated 14 Mar", () => {
    const window = resolveRemovalReportingWindow({
      earliestProductionStartTime: new Date("2026-03-14T14:00:00Z"),
      latestProductionEndTime: new Date("2026-03-15T02:30:00Z"),
      latestApplicationTime: day("2026-03-14"),
      facilityTimezone: "America/Bogota",
    });

    expect(window).toEqual({
      startedOn: day("2026-03-14"),
      completedOn: day("2026-03-14"),
    });
  });

  it("uses the facility day of the run start, not its UTC day, west of UTC", () => {
    const window = resolveRemovalReportingWindow({
      earliestProductionStartTime: new Date("2026-03-15T02:30:00Z"),
      latestProductionEndTime: new Date("2026-03-15T04:30:00Z"),
      latestApplicationTime: day("2026-03-14"),
      facilityTimezone: "America/Bogota",
    });

    expect(window.startedOn).toEqual(day("2026-03-14"));
    expect(window.completedOn).toEqual(day("2026-03-14"));
  });

  it("refuses an application day before the production end's facility day and prints that day", () => {
    const message = thrownMessage(() => resolveRemovalReportingWindow({
      earliestProductionStartTime: new Date("2026-03-14T14:00:00Z"),
      latestProductionEndTime: new Date("2026-03-15T02:30:00Z"),
      latestApplicationTime: day("2026-03-13"),
      facilityTimezone: "America/Bogota",
    }));

    expect(message).toBe(
      "Latest application date 2026-03-13 precedes latest production end date 2026-03-14. " +
        "Correct the application date before submitting.",
    );
    expect(message).not.toMatch(EN_OR_EM_DASH);
  });

  it("refuses by the facility day east of UTC and prints it", () => {
    const message = thrownMessage(() => resolveRemovalReportingWindow({
      earliestProductionStartTime: new Date("2026-07-29T06:00:00Z"),
      latestProductionEndTime: new Date("2026-07-29T22:30:00Z"),
      latestApplicationTime: day("2026-07-29"),
      facilityTimezone: "Africa/Dar_es_Salaam",
    }));

    expect(message).toBe(
      "Latest application date 2026-07-29 precedes latest production end date 2026-07-30. " +
        "Correct the application date before submitting.",
    );
    expect(message).not.toMatch(EN_OR_EM_DASH);
  });

  it("accepts an application on the facility day east of UTC", () => {
    const window = resolveRemovalReportingWindow({
      earliestProductionStartTime: new Date("2026-07-29T06:00:00Z"),
      latestProductionEndTime: new Date("2026-07-29T22:30:00Z"),
      latestApplicationTime: day("2026-07-30"),
      facilityTimezone: "Africa/Dar_es_Salaam",
    });

    expect(window).toEqual({
      startedOn: day("2026-07-29"),
      completedOn: day("2026-07-30"),
    });
  });

  it.each([
    { scenario: "earlier day refusal", application: "2026-07-28", completedOn: null },
    { scenario: "same day", application: "2026-07-29", completedOn: "2026-07-29" },
    { scenario: "later day", application: "2026-07-30", completedOn: "2026-07-30" },
  ])("compares facility days in a UTC facility: $scenario", ({ application, completedOn }) => {
    const resolve = () => resolveRemovalReportingWindow({
      earliestProductionStartTime: new Date("2026-07-29T06:00:00Z"),
      latestProductionEndTime: new Date("2026-07-29T15:30:00Z"),
      latestApplicationTime: day(application),
      facilityTimezone: "UTC",
    });
    if (completedOn === null) {
      expect(thrownMessage(resolve)).toBe(
        "Latest application date 2026-07-28 precedes latest production end date 2026-07-29. " +
          "Correct the application date before submitting.",
      );
    } else {
      expect(resolve()).toEqual({
        startedOn: day("2026-07-29"),
        completedOn: day(completedOn),
      });
    }
  });

  it("rejects an application day before an overnight production run ends", () => {
    expect(() =>
      resolveRemovalReportingWindow({
        earliestProductionStartTime: new Date("2026-07-29T23:00:00Z"),
        latestProductionEndTime: new Date("2026-07-30T01:00:00Z"),
        latestApplicationTime: day("2026-07-29"),
        facilityTimezone: "UTC",
      }),
    ).toThrow(
      /Latest application date 2026-07-29 precedes latest production end date 2026-07-30/,
    );
  });
});

describe("assertRemovalDatesNotFuture", () => {
  const now = new Date("2026-07-25T12:00:00.000Z");

  it("allows production and application dates exactly at the current instant", () => {
    expect(() =>
      assertRemovalDatesNotFuture({
        productionEndTime: now,
        latestApplicationTime: now,
        now,
      }),
    ).not.toThrow();
  });

  it("rejects a future production end with an actionable error", () => {
    const message = thrownMessage(() =>
      assertRemovalDatesNotFuture({
        productionEndTime: new Date("2026-07-25T12:00:00.001Z"),
        latestApplicationTime: now,
        now,
      }),
    );

    expect(message).toBe(
      "Latest production run ends at 2026-07-25T12:00:00.001Z. " +
        "Change the end time or wait until the run ends.",
    );
    expect(message).not.toMatch(EN_OR_EM_DASH);
  });

  it("rejects a future latest application with an actionable error", () => {
    const message = thrownMessage(() =>
      assertRemovalDatesNotFuture({
        productionEndTime: now,
        latestApplicationTime: new Date("2026-07-26T00:00:00.000Z"),
        now,
      }),
    );

    expect(message).toBe(
      "Latest application is dated 2026-07-26T00:00:00.000Z. " +
        "Change the application date or wait until then.",
    );
    expect(message).not.toMatch(EN_OR_EM_DASH);
  });
});
