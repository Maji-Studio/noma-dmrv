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
  it("keeps the UTC refusal for a Los Angeles run ending September 30 at 20:00 local", () => {
    const message = thrownMessage(() => resolveRemovalReportingWindow({
      earliestProductionStartTime: new Date("2026-09-30T15:00:00Z"),
      latestProductionEndTime: new Date("2026-10-01T03:00:00Z"),
      latestApplicationTime: new Date("2026-09-30T00:00:00Z"),
      facilityTimezone: "America/Los_Angeles",
    }));

    expect(message).toBe(
      "Latest application date 2026-09-30 precedes latest production end date 2026-10-01. " +
        "Correct the application date before submitting.",
    );
    expect(message).not.toMatch(EN_OR_EM_DASH);
  });

  // UTC facilities keep the UTC refusal and the same-day completion floor.
  it.each([
    {
      scenario: "earlier day refusal",
      application: "2026-07-28T00:00:00Z",
      expectedCompletedOn: null,
    },
    {
      scenario: "same day earlier application",
      application: "2026-07-29T00:00:00Z",
      expectedCompletedOn: "2026-07-29T15:30:00Z",
    },
    {
      scenario: "same instant",
      application: "2026-07-29T15:30:00Z",
      expectedCompletedOn: "2026-07-29T15:30:00Z",
    },
    {
      scenario: "same day later application",
      application: "2026-07-29T18:00:00Z",
      expectedCompletedOn: "2026-07-29T18:00:00Z",
    },
    {
      scenario: "later day",
      application: "2026-07-30T00:00:00Z",
      expectedCompletedOn: "2026-07-30T00:00:00Z",
    },
  ])("keeps the UTC refusal and completion rule for UTC facilities: $scenario", ({ application, expectedCompletedOn }) => {
    const earliestProductionStartTime = new Date("2026-07-29T06:00:00Z");
    const latestProductionEndTime = new Date("2026-07-29T15:30:00Z");
    const latestApplicationTime = new Date(application);
    const resolve = () => resolveRemovalReportingWindow({
      earliestProductionStartTime,
      latestProductionEndTime,
      latestApplicationTime,
      facilityTimezone: "UTC",
    });
    if (expectedCompletedOn === null) {
      expect(thrownMessage(resolve)).toBe(
        "Latest application date 2026-07-28 precedes latest production end date 2026-07-29. " +
          "Correct the application date before submitting.",
      );
    } else {
      expect(resolve()).toEqual({
        startedOn: earliestProductionStartTime,
        completedOn: new Date(expectedCompletedOn),
      });
    }
  });

  it("uses the latest run end as the same-day application time floor", () => {
    const window = resolveRemovalReportingWindow({
      earliestProductionStartTime: new Date("2026-07-29T06:00:00Z"),
      latestProductionEndTime: new Date("2026-07-29T15:30:00Z"),
      latestApplicationTime: new Date("2026-07-29T00:00:00Z"),
      facilityTimezone: "UTC",
    });

    expect(window.startedOn.toISOString()).toBe(
      "2026-07-29T06:00:00.000Z",
    );
    expect(window.completedOn.toISOString()).toBe(
      "2026-07-29T15:30:00.000Z",
    );
  });

  it("rejects an application day before an overnight production run ends", () => {
    expect(() =>
      resolveRemovalReportingWindow({
        earliestProductionStartTime: new Date("2026-07-29T23:00:00Z"),
        latestProductionEndTime: new Date("2026-07-30T01:00:00Z"),
        latestApplicationTime: new Date("2026-07-29T00:00:00Z"),
        facilityTimezone: "UTC",
      }),
    ).toThrow(
      /Latest application date 2026-07-29 precedes latest production end date 2026-07-30/,
    );
  });

  it("keeps a later application date as the reporting end", () => {
    const window = resolveRemovalReportingWindow({
      earliestProductionStartTime: new Date("2026-07-29T06:00:00Z"),
      latestProductionEndTime: new Date("2026-07-29T15:30:00Z"),
      latestApplicationTime: new Date("2026-07-30T00:00:00Z"),
      facilityTimezone: "UTC",
    });

    expect(window.completedOn.toISOString()).toBe(
      "2026-07-30T00:00:00.000Z",
    );
  });

  it("refuses the UTC application day before the production end's facility day", () => {
    const message = thrownMessage(() => resolveRemovalReportingWindow({
      earliestProductionStartTime: new Date("2026-07-29T06:00:00Z"),
      latestProductionEndTime: new Date("2026-07-29T22:30:00Z"),
      latestApplicationTime: new Date("2026-07-29T00:00:00Z"),
      facilityTimezone: "Africa/Dar_es_Salaam",
    }));

    expect(message).toBe(
      "Latest application date 2026-07-29 precedes latest production end date 2026-07-30. " +
        "Correct the application date before submitting.",
    );
    expect(message).not.toMatch(EN_OR_EM_DASH);
  });

  it.each([
    {
      zone: "Africa/Dar_es_Salaam",
      end: "2026-07-29T22:30:00Z",
      completed: "2026-07-30T00:00:00Z",
    },
    {
      zone: "America/Los_Angeles",
      end: "2026-07-30T02:30:00Z",
      completed: "2026-07-30T02:30:00Z",
    },
  ])("preserves the returned window for a valid application in $zone", ({ zone, end, completed }) => {
    const earliestProductionStartTime = new Date("2026-07-29T06:00:00Z");
    const window = resolveRemovalReportingWindow({
      earliestProductionStartTime,
      latestProductionEndTime: new Date(end),
      latestApplicationTime: new Date("2026-07-30T00:00:00Z"),
      facilityTimezone: zone,
    });

    expect(window).toEqual({
      startedOn: earliestProductionStartTime,
      completedOn: new Date(completed),
    });
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
