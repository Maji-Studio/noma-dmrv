import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { facilities } from "@/db/schema";
import { updateFacility } from "@/data-access/facility-mutations";
import { facilityTimezoneChangeMessage } from "@/data-access/facility-timezone-guard";
import { updateFacilityFn } from "@/fn/facilities";
import { DomainError } from "@/lib/domain-errors";
import { conflictCode } from "@/lib/conflict-ref";
import { facilityCalendarFixture } from "./helpers/facility-calendar-fixture";
import { ensureTestOrg, makeTestOrgContext } from "./helpers/test-org";

vi.mock("@/lib/auth/server", async (importOriginal) => {
  const { makeTestOrgContext } = await import("./helpers/test-org");
  return {
    ...await importOriginal<typeof import("@/lib/auth/server")>(),
    requireOrgContext: vi.fn().mockResolvedValue(makeTestOrgContext()),
  };
});

const CURRENT_ZONE = "Africa/Dar_es_Salaam";
const NEW_ZONE = "America/Los_Angeles";
const START = "2025-09-30T22:00:00.000Z";
const STORED_ALIAS = "Australia/Melbourne";
const CANONICAL_ZONE = "Australia/Sydney";

describe("facility time zone change refusal", () => {
  const f = facilityCalendarFixture("TZ-REFUSAL");
  const ctx = makeTestOrgContext();
  beforeAll(() => ensureTestOrg());
  afterAll(() => f.cleanup());

  async function savedFacility(id: string) {
    const [row] = await db.select().from(facilities).where(and(
      eq(facilities.id, id), eq(facilities.organizationId, ctx.organizationId),
    ));
    return row;
  }

  it("names Timezone and explains how to save other changes", () => {
    expect(facilityTimezoneChangeMessage("FAC-TEST", "CB-TEST", CURRENT_ZONE)).toBe(
      "Facility FAC-TEST was not saved. Credit batch CB-TEST holds production runs dated in this facility's timezone. Set Timezone back to Africa/Dar es Salaam (UTC+3) to save your other changes.",
    );
  });

  it.each([false, true])("preserves a stored alias when re-picking its entry (tier change: %s)", async (changeTier) => {
    const label = changeTier ? "ALIAS-TIER" : "ALIAS";
    const facility = await f.facility(label, STORED_ALIAS);
    const run = await f.run(facility.id, label, START);
    await f.batch(facility.id, run.id, label);
    const name = `${facility.name} renamed`;
    const saved = await updateFacility(ctx, facility.id, {
      expectedVersion: facility.version, timezone: CANONICAL_ZONE, name,
      ...(changeTier ? { durabilityOption: "200_year" as const } : {}),
    });
    const expected = {
      name, timezone: STORED_ALIAS, version: facility.version + 1,
      durabilityOption: changeTier ? "200_year" : facility.durabilityOption,
    };
    expect(saved).toMatchObject(expected);
    expect(await savedFacility(facility.id)).toMatchObject(expected);
  });

  it.each([false, true])("refuses a real change and preserves the row (tier change: %s)", async (changeTier) => {
    const facility = await f.facility(changeTier ? "TIER" : "NORMAL", CURRENT_ZONE);
    const run = await f.run(facility.id, changeTier ? "TIER" : "NORMAL", START);
    const batch = await f.batch(facility.id, run.id, changeTier ? "TIER" : "NORMAL");
    const error = await updateFacility(ctx, facility.id, {
      expectedVersion: facility.version, timezone: NEW_ZONE,
      ...(changeTier ? { durabilityOption: "200_year" as const } : {}),
    }).catch((error: unknown) => error);

    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({
      code: "conflict",
      message: facilityTimezoneChangeMessage(facility.code, batch.code, CURRENT_ZONE),
      conflict: { entity: "credit_batch", id: batch.id, code: conflictCode(batch.code) },
    });
    expect(await savedFacility(facility.id)).toEqual(facility);

    const name = `${facility.name} renamed`;
    const saved = await updateFacility(ctx, facility.id, {
      expectedVersion: facility.version, timezone: CURRENT_ZONE, name,
    });
    expect(saved).toMatchObject({ name, timezone: CURRENT_ZONE, version: facility.version + 1 });
  });

  it.each([false, true])("allows a change without credit batch membership (has run: %s)", async (hasRun) => {
    const facility = await f.facility(hasRun ? "UNASSIGNED" : "EMPTY", CURRENT_ZONE);
    if (hasRun) await f.run(facility.id, "UNASSIGNED", START);
    const saved = await updateFacility(ctx, facility.id, {
      expectedVersion: facility.version, timezone: NEW_ZONE,
    });
    expect(saved).toMatchObject({ timezone: NEW_ZONE, version: facility.version + 1 });
  });

  it("names the first blocking batch by code, regardless of insertion order", async () => {
    const facility = await f.facility("ORDER", CURRENT_ZONE);
    const laterRun = await f.run(facility.id, "ORDER-Z", START);
    const firstRun = await f.run(facility.id, "ORDER-A", START);
    await f.batch(facility.id, laterRun.id, "ORDER-Z");
    const firstBatch = await f.batch(facility.id, firstRun.id, "ORDER-A");
    await expect(updateFacility(ctx, facility.id, {
      expectedVersion: facility.version, timezone: NEW_ZONE,
    })).rejects.toMatchObject({
      code: "conflict",
      conflict: { entity: "credit_batch", id: firstBatch.id, code: firstBatch.code },
    });
  });

  it("returns the typed conflict and message through the server action", async () => {
    const facility = await f.facility("ACTION", CURRENT_ZONE);
    const run = await f.run(facility.id, "ACTION", START);
    const batch = await f.batch(facility.id, run.id, "ACTION");
    expect(await updateFacilityFn({
      facilityId: facility.id, expectedVersion: facility.version, timezone: NEW_ZONE,
    })).toMatchObject({
      success: false, code: "conflict",
      error: facilityTimezoneChangeMessage(facility.code, batch.code, CURRENT_ZONE),
      conflict: { entity: "credit_batch", id: batch.id, code: conflictCode(batch.code) },
    });
    expect(await savedFacility(facility.id)).toEqual(facility);
  });
});
