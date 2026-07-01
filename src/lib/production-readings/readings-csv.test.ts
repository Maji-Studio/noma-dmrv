import { describe, expect, it } from "vitest";
import { parseReadingsCsv, parseUtcTimestamp } from "./readings-csv";

const DAY_START = new Date("2026-04-02T00:00:00.000Z");
const TWO_DAYS_END = new Date("2026-04-04T00:00:00.000Z");

describe("parseReadingsCsv", () => {
  it("parses a canonical file spanning multiple UTC days", () => {
    const csv = [
      "timestamp_utc,temperature_c,pressure_bar,dryer_frequency_hz,reactor_frequency_hz",
      "2026-04-02T22:00:00Z,465.2,0.021,34.8,24.6",
      "2026-04-02T23:15:00Z,551.8,0.047,,24.8",
      "2026-04-03T00:00:00Z,554.0,0.049,34.7,24.9",
      "2026-04-03T01:30:00Z,548.9,0.043,34.9,",
      "",
    ].join("\n");

    const result = parseReadingsCsv({
      csvText: csv,
      runWindowStart: DAY_START,
      runWindowEnd: TWO_DAYS_END,
    });

    expect(result.parsedRows).toBe(4);
    expect(result.inWindowRows).toBe(4);
    expect(result.droppedRows).toBe(0);
    expect(result.skippedRows).toBe(0);
    expect(result.readings).toEqual([
      {
        timestamp: new Date("2026-04-02T22:00:00.000Z"),
        temperatureC: 465.2,
        pressureBar: 0.021,
        dryerFrequencyHz: 34.8,
        reactorFrequencyHz: 24.6,
      },
      {
        timestamp: new Date("2026-04-02T23:15:00.000Z"),
        temperatureC: 551.8,
        pressureBar: 0.047,
        dryerFrequencyHz: null, // blank optional cell -> null
        reactorFrequencyHz: 24.8,
      },
      {
        timestamp: new Date("2026-04-03T00:00:00.000Z"),
        temperatureC: 554.0,
        pressureBar: 0.049,
        dryerFrequencyHz: 34.7,
        reactorFrequencyHz: 24.9,
      },
      {
        timestamp: new Date("2026-04-03T01:30:00.000Z"),
        temperatureC: 548.9,
        pressureBar: 0.043,
        dryerFrequencyHz: 34.9,
        reactorFrequencyHz: null,
      },
    ]);
    expect(result.replacementWindow).toEqual({
      start: new Date("2026-04-02T22:00:00.000Z"),
      end: new Date("2026-04-03T01:30:00.001Z"),
    });
  });

  it("clips readings to the run window and counts drops separately from skips", () => {
    const csv = [
      "timestamp_utc,temperature_c,pressure_bar",
      "2026-04-01T23:59:00Z,400,0.01", // before window -> dropped
      "2026-04-02T06:00:00Z,500,0.02", // in window
      "not-a-timestamp,510,0.03", // skipped
      "2026-04-05T00:00:00Z,520,0.04", // after window -> dropped
    ].join("\n");

    const result = parseReadingsCsv({
      csvText: csv,
      runWindowStart: DAY_START,
      runWindowEnd: TWO_DAYS_END,
    });

    expect(result.parsedRows).toBe(3);
    expect(result.inWindowRows).toBe(1);
    expect(result.droppedRows).toBe(2);
    expect(result.skippedRows).toBe(1);
    expect(result.readings.map((r) => r.timestamp)).toEqual([
      new Date("2026-04-02T06:00:00.000Z"),
    ]);
  });

  it("sorts out-of-order rows and treats --- as a null sensor value", () => {
    const csv = [
      "timestamp_utc,temperature_c,pressure_bar",
      "2026-04-02T10:00:00Z,---,0.05",
      "2026-04-02T08:00:00Z,500,---",
    ].join("\n");

    const result = parseReadingsCsv({
      csvText: csv,
      runWindowStart: DAY_START,
      runWindowEnd: TWO_DAYS_END,
    });

    expect(result.readings).toEqual([
      {
        timestamp: new Date("2026-04-02T08:00:00.000Z"),
        temperatureC: 500,
        pressureBar: null,
        dryerFrequencyHz: null,
        reactorFrequencyHz: null,
      },
      {
        timestamp: new Date("2026-04-02T10:00:00.000Z"),
        temperatureC: null,
        pressureBar: 0.05,
        dryerFrequencyHz: null,
        reactorFrequencyHz: null,
      },
    ]);
  });

  it("returns a no-op replacement window when nothing lands in-window", () => {
    const csv = [
      "timestamp_utc,temperature_c,pressure_bar",
      "2026-04-10T00:00:00Z,500,0.02",
    ].join("\n");

    const result = parseReadingsCsv({
      csvText: csv,
      runWindowStart: DAY_START,
      runWindowEnd: TWO_DAYS_END,
    });

    expect(result.inWindowRows).toBe(0);
    expect(result.replacementWindow).toBeNull();
    expect(result.readings).toEqual([]);
  });

  it("throws a helpful error when a required column is missing", () => {
    const csv = ["timestamp_utc,temperature_c", "2026-04-02T08:00:00Z,500"].join(
      "\n",
    );

    expect(() =>
      parseReadingsCsv({
        csvText: csv,
        runWindowStart: DAY_START,
        runWindowEnd: TWO_DAYS_END,
      }),
    ).toThrow(/missing required column\(s\): pressure_bar/);
  });

  it("throws when the run has no time window", () => {
    const csv = ["timestamp_utc,temperature_c,pressure_bar"].join("\n");
    const sameInstant = new Date("2026-04-02T00:00:00.000Z");

    expect(() =>
      parseReadingsCsv({
        csvText: csv,
        runWindowStart: sameInstant,
        runWindowEnd: sameInstant,
      }),
    ).toThrow(/no time window/);
  });

  it("accepts canonical header aliases case-insensitively", () => {
    const csv = [
      "Timestamp,Temperature,Pressure,Dryer_Hz,Reactor_Hz",
      "2026-04-02T09:00:00Z,505,0.03,35,25",
    ].join("\n");

    const result = parseReadingsCsv({
      csvText: csv,
      runWindowStart: DAY_START,
      runWindowEnd: TWO_DAYS_END,
    });

    expect(result.readings[0]).toEqual({
      timestamp: new Date("2026-04-02T09:00:00.000Z"),
      temperatureC: 505,
      pressureBar: 0.03,
      dryerFrequencyHz: 35,
      reactorFrequencyHz: 25,
    });
  });
});

describe("parseUtcTimestamp", () => {
  it("treats a zone-less timestamp as UTC (not host local time)", () => {
    expect(parseUtcTimestamp("2026-04-02 22:15:00")).toEqual(
      new Date("2026-04-02T22:15:00.000Z"),
    );
    expect(parseUtcTimestamp("2026-04-02T22:15")).toEqual(
      new Date("2026-04-02T22:15:00.000Z"),
    );
  });

  it("honours an explicit numeric offset", () => {
    // 22:15 at +02:00 is 20:15 UTC.
    expect(parseUtcTimestamp("2026-04-02T22:15:00+02:00")).toEqual(
      new Date("2026-04-02T20:15:00.000Z"),
    );
    expect(parseUtcTimestamp("2026-04-02T00:15:00-05:00")).toEqual(
      new Date("2026-04-02T05:15:00.000Z"),
    );
  });

  it("parses fractional seconds and Z", () => {
    expect(parseUtcTimestamp("2026-04-02T22:15:30.5Z")).toEqual(
      new Date("2026-04-02T22:15:30.500Z"),
    );
  });

  it("honours an offset that shifts the instant onto another UTC day", () => {
    // 23:30 at -05:00 is 04:30 the NEXT UTC day — the offset legitimately
    // crosses midnight, which the rollover guard must not reject.
    expect(parseUtcTimestamp("2026-04-02T23:30:00-05:00")).toEqual(
      new Date("2026-04-03T04:30:00.000Z"),
    );
    // 01:00 at +05:00 is 20:00 the PREVIOUS UTC day.
    expect(parseUtcTimestamp("2026-04-02T01:00:00+05:00")).toEqual(
      new Date("2026-04-01T20:00:00.000Z"),
    );
  });

  it("rejects malformed and out-of-range values", () => {
    expect(parseUtcTimestamp("not-a-time")).toBeNull();
    expect(parseUtcTimestamp("2026-13-02T00:00:00Z")).toBeNull();
    expect(parseUtcTimestamp("2026-02-30T00:00:00Z")).toBeNull();
    expect(parseUtcTimestamp("2026-04-02T25:00:00Z")).toBeNull();
  });
});
