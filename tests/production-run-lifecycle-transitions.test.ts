import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { facilities, productionRuns, reactors } from "@/db/schema";
import { updateProductionRun } from "@/data-access/production-runs";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
} from "./helpers/test-org";

describe("updateProductionRun terminal to running", () => {
  const createdRunIds: string[] = [];
  const createdReactorIds: string[] = [];
  const createdFacilityIds: string[] = [];

  beforeAll(() => ensureTestOrg());

  afterAll(async () => {
    if (createdRunIds.length > 0) {
      await db
        .delete(productionRuns)
        .where(inArray(productionRuns.id, createdRunIds));
    }
    if (createdReactorIds.length > 0) {
      await db.delete(reactors).where(inArray(reactors.id, createdReactorIds));
    }
    if (createdFacilityIds.length > 0) {
      await db.delete(facilities).where(inArray(facilities.id, createdFacilityIds));
    }
  });

  it.each(["complete", "failed"] as const)(
    "clears endTime when reopening a %s run",
    async (status) => {
      const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
      const [facility] = await db
        .insert(facilities)
        .values({
          organizationId: TEST_ORG_ID,
          code: `FAC-REOPEN-${tag}`,
          name: `Reopen Facility ${tag}`,
        })
        .returning({ id: facilities.id });
      createdFacilityIds.push(facility.id);

      const [reactor] = await db
        .insert(reactors)
        .values({
          organizationId: TEST_ORG_ID,
          facilityId: facility.id,
          code: `R-REOPEN-${tag}`,
          identifier: `Reopen Reactor ${tag}`,
          reactorType: "auger",
        })
        .returning({ id: reactors.id });
      createdReactorIds.push(reactor.id);

      const [run] = await db
        .insert(productionRuns)
        .values({
          organizationId: TEST_ORG_ID,
          facilityId: facility.id,
          reactorId: reactor.id,
          code: `PR-REOPEN-${tag}`,
          status,
          startTime: new Date("2026-07-01T08:00:00Z"),
          endTime: new Date("2026-07-01T10:00:00Z"),
        })
        .returning({ id: productionRuns.id });
      createdRunIds.push(run.id);

      const reopened = await updateProductionRun(makeTestOrgContext(), run.id, {
        status: "running",
        endTime: null,
      });

      expect(reopened.status).toBe("running");
      expect(reopened.endTime).toBeNull();
    },
  );
});
