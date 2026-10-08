/** Real handlers and Postgres. Written for reviewer execution; never run by the implementation agent. */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { facilities, storageLocations } from "@/db/schema";
import { GET as FACILITIES_LIST } from "@/app/api/v1/facilities/route";
import { GET as FACILITIES_GET } from "@/app/api/v1/facilities/[idOrCode]/route";
import { GET as STORAGE_LOCATIONS_LIST } from "@/app/api/v1/storage-locations/route";
import { GET as STORAGE_LOCATIONS_GET } from "@/app/api/v1/storage-locations/[idOrCode]/route";
import { LOOKUP_ARCHIVE_INSTANT, LOOKUP_CODES, LOOKUP_IDS, lookupContract } from "./helpers/api-lookups";

lookupContract({
  resource: "facilities", list: FACILITIES_LIST, get: FACILITIES_GET,
  seed: async (fixture) => {
    const active = await db.insert(facilities).values(LOOKUP_IDS.map((id, index) => ({
      id, organizationId: fixture.ctx.organizationId, code: LOOKUP_CODES[index], name: `Lookup name ${index}`,
      createdAt: sql`${index === 0 ? "2026-10-08 12:00:00.123455" : "2026-10-08 12:00:00.123456"}::timestamp`,
      timezone: "Africa/Dar_es_Salaam",
    }))).returning();
    const [archived] = await db.insert(facilities).values({
      organizationId: fixture.ctx.organizationId, code: "LOOKUP-ARCHIVED", name: "Lookup name archived", archivedAt: LOOKUP_ARCHIVE_INSTANT,
      timezone: "Africa/Dar_es_Salaam",
    }).returning();
    return { active, archived };
  },
});

lookupContract({
  resource: "storage-locations", list: STORAGE_LOCATIONS_LIST, get: STORAGE_LOCATIONS_GET,
  seed: async (fixture) => {
    const active = await db.insert(storageLocations).values(LOOKUP_IDS.map((id, index) => ({
      id, organizationId: fixture.ctx.organizationId, code: LOOKUP_CODES[index], name: `Lookup name ${index}`,
      createdAt: sql`${index === 0 ? "2026-10-08 12:00:00.123455" : "2026-10-08 12:00:00.123456"}::timestamp`,
      facilityId: fixture.facilityId, type: "feedstock_bin" as const, capacityKg: 5000, feedstockTypeId: fixture.feedstockTypeId,
    }))).returning();
    const [archived] = await db.insert(storageLocations).values({
      organizationId: fixture.ctx.organizationId, code: "LOOKUP-ARCHIVED", name: "Lookup name archived", archivedAt: LOOKUP_ARCHIVE_INSTANT,
      facilityId: fixture.facilityId, type: "feedstock_bin" as const, capacityKg: 5000, feedstockTypeId: fixture.feedstockTypeId,
    }).returning();
    return { active, archived };
  },
});

