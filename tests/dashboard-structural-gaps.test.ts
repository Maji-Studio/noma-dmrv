/**
 * DB-backed regression coverage for the dashboard's structural certification
 * gaps. The fixture includes archived and out-of-scope parents so a missing
 * organization/facility/archive predicate fails loudly by inflating a count.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  facilities,
  feedstocks,
  feedstockTypes,
  organizations,
  transportLegs,
} from "@/db/schema";
import {
  buildDashboardStructuralGaps,
  loadDashboardStructuralGapCounts,
} from "@/data-access/dashboard-structural-gaps";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
} from "./helpers/test-org";

const TEST_USER_ID = "test-user-dashboard-structural-gaps";
const COMPLETE_ENDPOINTS = {
  originGpsLatitude: -6.8,
  originGpsLongitude: 39.28,
  destinationGpsLatitude: -6.16,
  destinationGpsLongitude: 35.75,
};

interface Fixture {
  gapFacilityId: string;
  clearFacilityId: string;
  excludedFacilityId: string;
  feedstockTypeId: string;
  feedstockIds: string[];
  transportLegIds: string[];
  foreignOrgId: string;
}

let dbReachable = true;
let fixture: Fixture | null = null;

beforeAll(async () => {
  try {
    await db.execute(sql`select 1`);
  } catch {
    dbReachable = false;
    return;
  }

  await ensureTestOrg();
  const tag = crypto.randomUUID().slice(0, 8);
  fixture = await db.transaction(async (tx) => {
    const foreignOrgId = `org-dashboard-gap-${tag}`;
    await tx.insert(organizations).values({
      id: foreignOrgId,
      name: `Dashboard gap foreign ${tag}`,
      slug: `dashboard-gap-foreign-${tag}`,
    });

    const [gapFacility, clearFacility, excludedFacility] = await tx
      .insert(facilities)
      .values([
        {
          organizationId: TEST_ORG_ID,
          code: `FAC-DG-GAP-${tag}`,
          name: `Dashboard gap ${tag}`,
        },
        {
          organizationId: TEST_ORG_ID,
          code: `FAC-DG-CLEAR-${tag}`,
          name: `Dashboard clear ${tag}`,
          gpsLatitude: -6.16,
          gpsLongitude: 35.75,
        },
        {
          organizationId: TEST_ORG_ID,
          code: `FAC-DG-OTHER-${tag}`,
          name: `Dashboard other ${tag}`,
        },
      ])
      .returning({ id: facilities.id });

    const [feedstockType] = await tx
      .insert(feedstockTypes)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FT-DG-${tag}`,
        name: `Dashboard gap feedstock ${tag}`,
        category: "forestry",
      })
      .returning({ id: feedstockTypes.id });

    const [activeFeedstock, archivedFeedstock, excludedFeedstock] = await tx
      .insert(feedstocks)
      .values([
        {
          organizationId: TEST_ORG_ID,
          code: `FS-DG-ACTIVE-${tag}`,
          facilityId: gapFacility.id,
          feedstockTypeId: feedstockType.id,
          massDryKg: 100,
        },
        {
          organizationId: TEST_ORG_ID,
          code: `FS-DG-ARCHIVED-${tag}`,
          facilityId: gapFacility.id,
          feedstockTypeId: feedstockType.id,
          massDryKg: 100,
          archivedAt: new Date(),
        },
        {
          organizationId: TEST_ORG_ID,
          code: `FS-DG-OTHER-${tag}`,
          facilityId: excludedFacility.id,
          feedstockTypeId: feedstockType.id,
          massDryKg: 100,
        },
      ])
      .returning({ id: feedstocks.id });

    const legRows = await tx
      .insert(transportLegs)
      .values([
        {
          organizationId: TEST_ORG_ID,
          entityType: "feedstock",
          entityId: activeFeedstock.id,
          originGpsLatitude: null,
          originGpsLongitude: null,
          destinationGpsLatitude: -6.16,
          destinationGpsLongitude: 35.75,
          distanceKm: 25,
          distanceSource: "manual",
          transportMethodType: "road",
          loadMassKg: 100,
        },
        {
          organizationId: TEST_ORG_ID,
          entityType: "feedstock",
          entityId: activeFeedstock.id,
          ...COMPLETE_ENDPOINTS,
          distanceKm: 25,
          distanceSource: "document",
          transportMethodType: "road",
          loadMassKg: 100,
        },
        {
          organizationId: TEST_ORG_ID,
          entityType: "feedstock",
          entityId: archivedFeedstock.id,
          distanceKm: 25,
          distanceSource: null,
          transportMethodType: "road",
          loadMassKg: 100,
        },
        {
          organizationId: TEST_ORG_ID,
          entityType: "feedstock",
          entityId: excludedFeedstock.id,
          distanceKm: 25,
          distanceSource: null,
          transportMethodType: "road",
          loadMassKg: 100,
        },
        {
          organizationId: foreignOrgId,
          entityType: "feedstock",
          entityId: activeFeedstock.id,
          distanceKm: 25,
          distanceSource: null,
          transportMethodType: "road",
          loadMassKg: 100,
        },
      ])
      .returning({ id: transportLegs.id });

    return {
      gapFacilityId: gapFacility.id,
      clearFacilityId: clearFacility.id,
      excludedFacilityId: excludedFacility.id,
      feedstockTypeId: feedstockType.id,
      feedstockIds: [
        activeFeedstock.id,
        archivedFeedstock.id,
        excludedFeedstock.id,
      ],
      transportLegIds: legRows.map((row) => row.id),
      foreignOrgId,
    };
  });
});

afterAll(async () => {
  if (!fixture) return;
  await db.delete(transportLegs).where(inArray(transportLegs.id, fixture.transportLegIds));
  await db.delete(feedstocks).where(inArray(feedstocks.id, fixture.feedstockIds));
  await db.delete(feedstockTypes).where(eq(feedstockTypes.id, fixture.feedstockTypeId));
  await db
    .delete(facilities)
    .where(
      inArray(facilities.id, [
        fixture.gapFacilityId,
        fixture.clearFacilityId,
        fixture.excludedFacilityId,
      ]),
    );
  await db.delete(organizations).where(eq(organizations.id, fixture.foreignOrgId));
});

describe("dashboard structural certification gaps", () => {
  it("counts all four gaps and excludes archived, foreign-org, and other-facility rows", async (ctx) => {
    if (!dbReachable || !fixture) {
      ctx.skip();
      return;
    }

    const counts = await loadDashboardStructuralGapCounts(
      makeTestOrgContext(TEST_USER_ID),
      fixture.gapFacilityId,
    );

    expect(counts).toEqual({
      missingFacilityGps: 1,
      missingFeedstockGps: 1,
      transportEndpointGpsGaps: 1,
      transportDistanceEvidenceGaps: 1,
    });
    expect(
      buildDashboardStructuralGaps(counts, fixture.gapFacilityId).map(
        ({ key, count, href }) => ({ key, count, href }),
      ),
    ).toEqual([
      {
        key: "facilityGps",
        count: 1,
        href: `/facilities?facility=${fixture.gapFacilityId}`,
      },
      {
        key: "feedstockGps",
        count: 1,
        href: `/feedstocks?facility=${fixture.gapFacilityId}`,
      },
      {
        key: "transportEndpointGps",
        count: 1,
        href: `/chain-of-custody?facility=${fixture.gapFacilityId}`,
      },
      {
        key: "transportDistanceEvidence",
        count: 1,
        href: `/chain-of-custody?facility=${fixture.gapFacilityId}`,
      },
    ]);
  });

  it("returns no structural blockers for a complete empty facility", async (ctx) => {
    if (!dbReachable || !fixture) {
      ctx.skip();
      return;
    }

    const counts = await loadDashboardStructuralGapCounts(
      makeTestOrgContext(TEST_USER_ID),
      fixture.clearFacilityId,
    );

    expect(counts).toEqual({
      missingFacilityGps: 0,
      missingFeedstockGps: 0,
      transportEndpointGpsGaps: 0,
      transportDistanceEvidenceGaps: 0,
    });
    expect(buildDashboardStructuralGaps(counts, fixture.clearFacilityId)).toEqual([]);
  });
});
