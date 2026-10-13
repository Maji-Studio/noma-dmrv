/** Real handlers and Postgres. Written for reviewer execution; never run by the implementation agent. */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { suppliers, feedstockTypes } from "@/db/schema";
import { GET as SUPPLIERS_LIST } from "@/app/api/v1/suppliers/route";
import { GET as SUPPLIERS_GET } from "@/app/api/v1/suppliers/[idOrCode]/route";
import { GET as FEEDSTOCK_TYPES_LIST } from "@/app/api/v1/feedstock-types/route";
import { GET as FEEDSTOCK_TYPES_GET } from "@/app/api/v1/feedstock-types/[idOrCode]/route";
import { LOOKUP_ARCHIVE_INSTANT, LOOKUP_CODES, LOOKUP_IDS, lookupContract } from "./helpers/api-lookups";

lookupContract({
  resource: "suppliers", list: SUPPLIERS_LIST, get: SUPPLIERS_GET,
  seed: async (fixture) => {
    const active = await db.insert(suppliers).values(LOOKUP_IDS.map((id, index) => ({
      id, organizationId: fixture.ctx.organizationId, code: LOOKUP_CODES[index], name: `Lookup name ${index}`,
      createdAt: sql`${index === 0 ? "2026-10-08 12:00:00.123455" : "2026-10-08 12:00:00.123456"}::timestamp`,
      contactName: "Hidden", contactEmail: "hidden@example.test", contactPhone: "Hidden",
    }))).returning();
    return { active };
  },
});

lookupContract({
  resource: "feedstock-types", list: FEEDSTOCK_TYPES_LIST, get: FEEDSTOCK_TYPES_GET,
  seed: async (fixture) => {
    const active = await db.insert(feedstockTypes).values(LOOKUP_IDS.map((id, index) => ({
      id, organizationId: fixture.ctx.organizationId, code: LOOKUP_CODES[index], name: `Lookup name ${index}`,
      createdAt: sql`${index === 0 ? "2026-10-08 12:00:00.123455" : "2026-10-08 12:00:00.123456"}::timestamp`,
      category: "forestry", usage: "pyrolysis" as const,
    }))).returning();
    const [archived] = await db.insert(feedstockTypes).values({
      organizationId: fixture.ctx.organizationId, code: "LOOKUP-ARCHIVED", name: "Lookup name archived", archivedAt: LOOKUP_ARCHIVE_INSTANT,
      category: "forestry", usage: "pyrolysis" as const,
    }).returning();
    return { active, archived };
  },
});

