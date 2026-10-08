/** Real handlers and Postgres. Written for reviewer execution; never run by the implementation agent. */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { vehicles, drivers } from "@/db/schema";
import { GET as VEHICLES_LIST } from "@/app/api/v1/vehicles/route";
import { GET as VEHICLES_GET } from "@/app/api/v1/vehicles/[idOrCode]/route";
import { GET as DRIVERS_LIST } from "@/app/api/v1/drivers/route";
import { GET as DRIVERS_GET } from "@/app/api/v1/drivers/[idOrCode]/route";
import { LOOKUP_CODES, LOOKUP_IDS, lookupContract } from "./helpers/api-lookups";

lookupContract({
  resource: "vehicles", list: VEHICLES_LIST, get: VEHICLES_GET,
  seed: async (fixture) => {
    const active = await db.insert(vehicles).values(LOOKUP_IDS.map((id, index) => ({
      id, organizationId: fixture.ctx.organizationId, code: LOOKUP_CODES[index], name: `Lookup name ${index}`,
      createdAt: sql`${index === 0 ? "2026-10-08 12:00:00.123455" : "2026-10-08 12:00:00.123456"}::timestamp`,
      vehicleType: "truck", identifier: "T 123 ABC",
    }))).returning();
    return { active };
  },
});

lookupContract({
  resource: "drivers", list: DRIVERS_LIST, get: DRIVERS_GET,
  seed: async (fixture) => {
    const active = await db.insert(drivers).values(LOOKUP_IDS.map((id, index) => ({
      id, organizationId: fixture.ctx.organizationId, code: LOOKUP_CODES[index], name: `Lookup name ${index}`,
      createdAt: sql`${index === 0 ? "2026-10-08 12:00:00.123455" : "2026-10-08 12:00:00.123456"}::timestamp`,
      licenseNumber: "Hidden", contactPhone: "Hidden",
    }))).returning();
    return { active };
  },
});

