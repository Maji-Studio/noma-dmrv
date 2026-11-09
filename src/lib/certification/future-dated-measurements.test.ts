import { describe, expect, it } from "vitest";
import { collectFutureDatedMeasurements } from "./future-dated-measurements";

const NOW = new Date("2026-07-25T12:00:00.000Z");
const EN_OR_EM_DASH = /[\u2013\u2014]/;

function run(code: string, endTime: Date | null) {
  return { code, endTime };
}

function lineage(code: string, applicationDate: Date) {
  return { application: { code, applicationDate } };
}

function sample(sampleCode: string, samplingTime: Date) {
  return { sampleCode, samplingTime };
}

describe("collectFutureDatedMeasurements", () => {
  it("reports nothing when every date has already happened", () => {
    expect(
      collectFutureDatedMeasurements({
        runs: [run("PR-0001", new Date("2026-07-20T08:00:00.000Z"))],
        lineages: [lineage("APP-0001", new Date("2026-07-24T00:00:00.000Z"))],
        now: NOW,
        facilityTimezone: "UTC",
      }),
    ).toEqual([]);
  });

  it("accepts a date equal to now — the submit guard compares strictly", () => {
    expect(
      collectFutureDatedMeasurements({
        runs: [run("PR-0001", NOW)],
        lineages: [lineage("APP-0001", NOW)],
        now: NOW,
        facilityTimezone: "UTC",
      }),
    ).toEqual([]);
  });

  it("names the run whose end time is still in the future", () => {
    const [blocker, ...rest] = collectFutureDatedMeasurements({
      runs: [run("PR-0007", new Date("2026-08-01T06:00:00.000Z"))],
      lineages: [],
      now: NOW,
      facilityTimezone: "UTC",
    });

    expect(rest).toEqual([]);
    expect(blocker).toBe(
      "Production run PR-0007 ends on 2026-08-01. " +
        "Change the end time or wait until the run ends.",
    );
    expect(blocker).not.toMatch(EN_OR_EM_DASH);
  });

  it.each([
    { zone: "Africa/Dar_es_Salaam", start: "2026-07-25T22:30:00Z", end: "2026-07-25T23:30:00Z", day: "2026-07-26" },
    { zone: "America/Los_Angeles", start: "2026-07-26T02:30:00Z", end: "2026-07-26T03:30:00Z", day: "2026-07-25" },
  ])("keeps the instant check and prints the facility day in $zone", ({ zone, start, end, day }) => {
    const runs = [run("PR-0007", new Date(end))];
    const blockers = collectFutureDatedMeasurements({ runs, lineages: [], now: new Date(start), facilityTimezone: zone });
    expect(blockers).toEqual([
      `Production run PR-0007 ends on ${day}. Change the end time or wait until the run ends.`,
    ]);
    expect(blockers[0]).not.toMatch(EN_OR_EM_DASH);
    expect(collectFutureDatedMeasurements({ runs, lineages: [], now: new Date(end), facilityTimezone: zone })).toEqual([]);
  });

  it("names the application dated in the future", () => {
    const [blocker] = collectFutureDatedMeasurements({
      runs: [],
      lineages: [lineage("APP-0003", new Date("2026-08-14T00:00:00.000Z"))],
      now: NOW,
      facilityTimezone: "UTC",
    });

    expect(blocker).toBe(
      "Application APP-0003 is dated 2026-08-14. " +
        "Change the application date or wait until then.",
    );
    expect(blocker).not.toMatch(EN_OR_EM_DASH);
  });

  it("names the Sample whose sampling time is in the future", () => {
    const [blocker] = collectFutureDatedMeasurements({
      runs: [],
      samples: [sample("LAB-0042", new Date("2026-08-14T09:30:00.000Z"))],
      lineages: [],
      now: NOW,
      facilityTimezone: "UTC",
    });

    expect(blocker).toBe(
      "Sample LAB-0042 is dated 2026-08-14. " +
        "Change the sampling time or wait until then.",
    );
    expect(blocker).not.toMatch(EN_OR_EM_DASH);
  });

  it("reports every offending record, runs before applications", () => {
    const blockers = collectFutureDatedMeasurements({
      runs: [
        run("PR-0007", new Date("2026-08-01T06:00:00.000Z")),
        run("PR-0008", new Date("2026-07-01T06:00:00.000Z")),
      ],
      lineages: [
        lineage("APP-0003", new Date("2026-08-14T00:00:00.000Z")),
        lineage("APP-0004", new Date("2026-07-02T00:00:00.000Z")),
      ],
      now: NOW,
      facilityTimezone: "UTC",
    });

    expect(blockers).toHaveLength(2);
    expect(blockers[0]).toContain("PR-0007");
    expect(blockers[1]).toContain("APP-0003");
  });

  it("ignores an open run — that is the aggregation step's blocker", () => {
    expect(
      collectFutureDatedMeasurements({
        runs: [run("PR-0009", null)],
        lineages: [],
        now: NOW,
        facilityTimezone: "UTC",
      }),
    ).toEqual([]);
  });

  it("ignores a Sample with no sampling time — Sample readiness owns that blocker", () => {
    expect(
      collectFutureDatedMeasurements({
        runs: [],
        samples: [{ sampleCode: "LAB-0042" }],
        lineages: [],
        now: NOW,
        facilityTimezone: "UTC",
      }),
    ).toEqual([]);
  });

  it("does not repeat a record reached through several lineages", () => {
    const applicationDate = new Date("2026-08-14T00:00:00.000Z");
    expect(
      collectFutureDatedMeasurements({
        runs: [],
        lineages: [
          lineage("APP-0003", applicationDate),
          lineage("APP-0003", applicationDate),
        ],
        now: NOW,
        facilityTimezone: "UTC",
      }),
    ).toHaveLength(1);
  });
});
