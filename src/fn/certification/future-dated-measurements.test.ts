import { describe, expect, it } from "vitest";
import { collectFutureDatedMeasurements } from "./future-dated-measurements";

const NOW = new Date("2026-07-25T12:00:00.000Z");

function run(code: string, endTime: Date | null) {
  return { code, endTime };
}

function lineage(code: string, applicationDate: Date) {
  return { application: { code, applicationDate } };
}

describe("collectFutureDatedMeasurements", () => {
  it("reports nothing when every date has already happened", () => {
    expect(
      collectFutureDatedMeasurements({
        runs: [run("PR-0001", new Date("2026-07-20T08:00:00.000Z"))],
        lineages: [lineage("APP-0001", new Date("2026-07-24T00:00:00.000Z"))],
        now: NOW,
      }),
    ).toEqual([]);
  });

  it("accepts a date equal to now — the submit guard compares strictly", () => {
    expect(
      collectFutureDatedMeasurements({
        runs: [run("PR-0001", NOW)],
        lineages: [lineage("APP-0001", NOW)],
        now: NOW,
      }),
    ).toEqual([]);
  });

  it("names the run whose end time is still in the future", () => {
    const [blocker, ...rest] = collectFutureDatedMeasurements({
      runs: [run("PR-0007", new Date("2026-08-01T06:00:00.000Z"))],
      lineages: [],
      now: NOW,
    });

    expect(rest).toEqual([]);
    expect(blocker).toContain("PR-0007");
    expect(blocker).toContain("2026-08-01");
    expect(blocker).toContain("correct the run end time");
    expect(blocker).toContain("UTC");
  });

  it("names the application dated in the future", () => {
    const [blocker] = collectFutureDatedMeasurements({
      runs: [],
      lineages: [lineage("APP-0003", new Date("2026-08-14T00:00:00.000Z"))],
      now: NOW,
    });

    expect(blocker).toContain("APP-0003");
    expect(blocker).toContain("2026-08-14");
    expect(blocker).toContain("correct the application date");
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
      }),
    ).toHaveLength(1);
  });
});
