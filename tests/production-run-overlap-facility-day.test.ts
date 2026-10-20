import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { assertNoReactorRunOverlap } from "@/data-access/production-runs/overlap";
import { facilityCalendarFixture } from "./helpers/facility-calendar-fixture";
import { ensureTestOrg, makeTestOrgContext } from "./helpers/test-org";

const CASES = [
  { label: "DAR", zone: "Africa/Dar_es_Salaam", start: "2026-07-25T22:30:00Z", window: "2026-07-26 01:30 to 02:30" },
  { label: "LA", zone: "America/Los_Angeles", start: "2026-07-26T02:30:00Z", window: "2026-07-25 19:30 to 20:30" },
];

describe("reactor overlap refusal uses the conflicting facility's day", () => {
  const f = facilityCalendarFixture("OVERLAP-DAY");
  const ctx = makeTestOrgContext();
  beforeAll(() => ensureTestOrg());
  afterAll(() => f.cleanup());

  it.each(CASES)("refuses an overlap and permits a touching window in $zone", async ({ label, zone, start, window }) => {
    const facility = await f.facility(label, zone);
    const run = await f.run(facility.id, label, start);
    await expect(db.transaction((tx) => assertNoReactorRunOverlap(ctx, tx, {
      reactorId: run.reactorId!, startTime: run.startTime, endTime: run.endTime,
    }))).rejects.toMatchObject({
      message: `Overlaps run ${run.code} (${window}) on this reactor`,
      code: "conflict",
      conflict: { entity: "productionRun", id: run.id, code: run.code },
    });
    await expect(db.transaction((tx) => assertNoReactorRunOverlap(ctx, tx, {
      reactorId: run.reactorId!, startTime: run.endTime!, endTime: null,
    }))).resolves.toBeUndefined();
  });
});
