/** Real handlers, credentials and Postgres. Written for reviewer execution; never run by the implementation agent. */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { feedstockTypes, formulationIngredients, formulations } from "@/db/schema";
import { GET as LIST } from "@/app/api/v1/formulations/route";
import { GET } from "@/app/api/v1/formulations/[idOrCode]/route";
import { formulationRepresentationSchema } from "@/lib/representations/formulations";
import {
  createLookupFixture, LOOKUP_CODES, LOOKUP_IDS, LOOKUP_SUITE_TIMEOUT_MS, lookupContract, lookupParams, lookupProblem, lookupRequest, removeLookupFixture,
  type LookupFixture,
} from "./helpers/api-lookups";

// Formulations have no archive, so the shared contract seeds no archived row.
lookupContract({
  resource: "formulations", list: LIST, get: GET,
  seed: async (fixture) => {
    const active = await db.insert(formulations).values(LOOKUP_IDS.map((id, index) => ({
      id, organizationId: fixture.ctx.organizationId, code: LOOKUP_CODES[index], name: `Lookup name ${index}`, biocharRatio: 1,
      createdAt: sql`${index === 0 ? "2026-10-08 12:00:00.123455" : "2026-10-08 12:00:00.123456"}::timestamp`,
    }))).returning();
    return { active };
  },
});

describe("formulation lines", { timeout: LOOKUP_SUITE_TIMEOUT_MS }, () => {
  let a: LookupFixture;
  let b: LookupFixture;
  beforeEach(async () => { a = await createLookupFixture(); b = await createLookupFixture(); });
  afterEach(async () => { await removeLookupFixture(a); await removeLookupFixture(b); });

  it("returns lines in recipe order as ids and ratios, and Pure biochar with none", async () => {
    const organizationId = a.ctx.organizationId;
    const [recipe] = await db.insert(formulations).values({ organizationId, code: "FORM-MIX", name: "Mix", biocharRatio: 0.6 }).returning();
    const [pure] = await db.insert(formulations).values({ organizationId, code: "FORM-PURE", name: "Pure biochar", biocharRatio: 1 }).returning();
    const types = await db.insert(feedstockTypes).values([0, 1].map((index) => ({ organizationId, code: `FT-${randomUUID().slice(0, 6)}-${index}`, name: `Type ${index}`, category: "compost", usage: "blend" as const }))).returning();
    const lines = await db.insert(formulationIngredients).values([
      { organizationId, formulationId: recipe.id, feedstockTypeId: types[0].id, ratio: 0.1, sortOrder: 1 },
      { organizationId, formulationId: recipe.id, feedstockTypeId: types[1].id, ratio: null, sortOrder: 0 },
    ]).returning();
    const { data } = await (await GET(lookupRequest("formulations", `/${recipe.code}`, a.key), lookupParams(recipe.code))).json();
    expect(formulationRepresentationSchema.parse(data)).toEqual(data);
    expect(data.lines).toEqual([
      { id: lines[1].id, feedstockTypeId: types[1].id, ratio: null },
      { id: lines[0].id, feedstockTypeId: types[0].id, ratio: 0.1 },
    ]);
    expect(data).toMatchObject({ biocharRatio: 0.6, archivedAt: null });
    expect(data).not.toHaveProperty("description");
    const pureResponse = await GET(lookupRequest("formulations", `/${pure.id}`, a.key), lookupParams(pure.id));
    expect((await pureResponse.json()).data).toMatchObject({ code: "FORM-PURE", biocharRatio: 1, lines: [] });
    const listed = await (await LIST(lookupRequest("formulations", "", a.key))).json();
    expect(listed.data.map((row: { id: string }) => row.id).sort()).toEqual([recipe.id, pure.id].sort());
    await lookupProblem(await GET(lookupRequest("formulations", `/${recipe.id}`, b.key), lookupParams(recipe.id)), 404, "not_found");
    await lookupProblem(await GET(lookupRequest("formulations", `/${recipe.id}`, a.missingScopeKey), lookupParams(recipe.id)), 403, "missing_scope");
  });
});
