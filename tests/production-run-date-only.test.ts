import { afterEach, describe, expect, it } from "vitest";
import { formatLocalDate } from "@/lib/date-utils";
import {
  createProductionRunSchema,
  productionRunFormSchema,
  updateProductionRunSchema,
} from "@/schemas/production-runs";
import { runWindowsConflict } from "@/data-access/production-runs/overlap";

const FACILITY_ID = "11111111-1111-4111-8111-111111111111";
const REACTOR_ID = "22222222-2222-4222-8222-222222222222";
const RUN_DATE = "2026-06-13";

const originalTz = process.env.TZ;

afterEach(() => {
  process.env.TZ = originalTz;
});

describe("production run start-date handling", () => {
  it("stores the selected calendar day in a timezone ahead of UTC", () => {
    process.env.TZ = "Europe/Zurich";

    const parsed = createProductionRunSchema.parse({
      facilityId: FACILITY_ID,
      startDate: RUN_DATE,
      reactorId: REACTOR_ID,
      status: "draft",
      startTime: "10:00",
    });

    expect(parsed.startDate).toBeInstanceOf(Date);
    expect(formatLocalDate(parsed.startDate as Date)).toBe(RUN_DATE);
    // Local-midnight parse, not UTC — the ISO date is the previous day here.
    expect((parsed.startDate as Date).toISOString().slice(0, 10)).toBe("2026-06-12");
  });

  it("rejects overflowed calendar dates", () => {
    const parsed = productionRunFormSchema.safeParse({
      facilityId: FACILITY_ID,
      startDate: "2026-02-31",
      reactorId: REACTOR_ID,
      status: "draft",
      startTime: "10:00",
    });

    expect(parsed.success).toBe(false);
  });
});

describe("production run window validation", () => {
  const base = {
    facilityId: FACILITY_ID,
    reactorId: REACTOR_ID,
    startDate: RUN_DATE,
    startTime: "08:00",
  };

  it("accepts an open run (no end time) in draft", () => {
    const parsed = createProductionRunSchema.safeParse({ ...base, status: "draft" });
    expect(parsed.success).toBe(true);
  });

  it("rejects an end time on or before the start time (same day)", () => {
    const parsed = createProductionRunSchema.safeParse({
      ...base,
      status: "running",
      endTime: "07:00",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts an overnight run when the end date is the next day", () => {
    const parsed = productionRunFormSchema.safeParse({
      ...base,
      startTime: "22:00",
      endDate: "2026-06-14",
      endTime: "02:00",
      status: "complete",
      feedstockDraws: [{
        storageLocationId: "33333333-3333-4333-8333-333333333333",
        wetMassKg: 100,
      }],
      feedstockMoisturePercent: 10,
      biocharOutputKg: 20,
    });
    expect(parsed.success).toBe(true);
  });

  it("requires an end time for a complete run", () => {
    const parsed = createProductionRunSchema.safeParse({ ...base, status: "complete" });
    expect(parsed.success).toBe(false);
  });

  it("accepts an explicit null end time in an update payload", () => {
    const parsed = updateProductionRunSchema.parse({
      productionRunId: "33333333-3333-4333-8333-333333333333",
      status: "running",
      endTime: null,
    });

    expect(parsed.endTime).toBeNull();
  });
});

describe("runWindowsConflict predicate", () => {
  const t = (h: number) => new Date(2026, 5, 14, h).getTime();

  it("detects two overlapping closed windows", () => {
    // 08:00–12:00 vs 10:00–14:00
    expect(
      runWindowsConflict({ start: t(8), end: t(12) }, { start: t(10), end: t(14) }),
    ).toBe(true);
  });

  it("treats abutting windows as non-conflicting (half-open)", () => {
    // 08:00–10:00 vs 10:00–12:00 share only the boundary instant
    expect(
      runWindowsConflict({ start: t(8), end: t(10) }, { start: t(10), end: t(12) }),
    ).toBe(false);
  });

  it("blocks a new run at/after an existing open run's start", () => {
    // existing open run started 08:00; candidate at 10:00 (open or closed) conflicts
    expect(
      runWindowsConflict({ start: t(10), end: null }, { start: t(8), end: null }),
    ).toBe(true);
    expect(
      runWindowsConflict({ start: t(10), end: t(12) }, { start: t(8), end: null }),
    ).toBe(true);
  });

  it("allows backfilling a run that fully precedes an open run", () => {
    // candidate 04:00–06:00 fully before the open run's 08:00 start
    expect(
      runWindowsConflict({ start: t(4), end: t(6) }, { start: t(8), end: null }),
    ).toBe(false);
  });
});
