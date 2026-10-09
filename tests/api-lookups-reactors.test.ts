import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { reactors } from "@/db/schema";
import { GET as LIST } from "@/app/api/v1/reactors/route";
import { GET } from "@/app/api/v1/reactors/[idOrCode]/route";
import { LOOKUP_ARCHIVE_INSTANT, LOOKUP_CODES, LOOKUP_IDS, lookupContract, createLookupFixture, removeLookupFixture, lookupRequest, lookupProblem } from "./helpers/api-lookups";

lookupContract({
  resource: "reactors", list: LIST, get: GET,
  seed: async (fixture) => {
    const active = await db.insert(reactors).values(LOOKUP_IDS.map((id, index) => ({
      id, organizationId: fixture.ctx.organizationId, facilityId: fixture.facilityId,
      code: LOOKUP_CODES[index], identifier: `Lookup name ${index}`, reactorType: "auger",
      createdAt: sql`${index === 0 ? "2026-10-08 12:00:00.123455" : "2026-10-08 12:00:00.123456"}::timestamp`,
    }))).returning();
    const [archived] = await db.insert(reactors).values({
      organizationId: fixture.ctx.organizationId, facilityId: fixture.facilityId,
      code: "LOOKUP-ARCHIVED", identifier: "Lookup name archived", reactorType: "auger", archivedAt: LOOKUP_ARCHIVE_INSTANT,
    }).returning();
    return { active: active.map((row) => ({ ...row, name: row.identifier })), archived: { ...archived, name: archived.identifier } };
  },
});

it("filters reactors by facility and refuses a foreign facility filter", async () => {
  const a = await createLookupFixture();
  const b = await createLookupFixture();
  try {
    const [row] = await db.insert(reactors).values({ organizationId: a.ctx.organizationId, facilityId: a.facilityId, code: `R-${randomUUID()}`, identifier: "Facility reactor", reactorType: "auger" }).returning();
    const response = await LIST(lookupRequest("reactors", `?facilityId=${a.facilityId}`, a.key));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject([{ id: row.id, facilityId: a.facilityId }]);
    await lookupProblem(await LIST(lookupRequest("reactors", `?facilityId=${b.facilityId}`, a.key)), 404, "not_found");
  } finally { await removeLookupFixture(a); await removeLookupFixture(b); }
});
