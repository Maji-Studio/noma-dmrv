import { getOAuthConfig } from "@/lib/auth/oauth-config";
/** Real handlers, credentials and Postgres. Written for reviewer execution; never run by the implementation agent. */
import { createApiKey } from "@/data-access/api-keys";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import { resolveApiContext } from "@/lib/auth/api-context";
import { principalAllows, type ApiScope } from "@/lib/auth/api-scopes";
import { apiRoute } from "@/lib/api/route";
import { toolFailure } from "@/lib/mcp/results";
import { readTools } from "@/lib/mcp/tools/read-tools";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { feedstockTypes, formulationIngredients, formulations } from "@/db/schema";
import { GET as LIST } from "@/app/api/v1/formulations/route";
import { GET } from "@/app/api/v1/formulations/[idOrCode]/route";
import { archiveFormulationApi } from "@/lib/operations/formulation-api";
import { runOperationInProcess } from "@/lib/operations/runner";
import { formulationRepresentationSchema } from "@/lib/representations/formulations";
import {
  createLookupFixture, LOOKUP_CODES, LOOKUP_IDS, LOOKUP_SUITE_TIMEOUT_MS, lookupContract, lookupParams, lookupProblem, lookupRequest, removeLookupFixture,
  type LookupFixture,
} from "./helpers/api-lookups";

lookupContract({
  resource: "formulations", list: LIST, get: GET, revision: 2,
  seed: async (fixture) => {
    const active = await db.insert(formulations).values(LOOKUP_IDS.map((id, index) => ({
      id, organizationId: fixture.ctx.organizationId, code: LOOKUP_CODES[index], name: `Lookup name ${index}`, biocharRatio: 1,
      createdAt: sql`${index === 0 ? "2026-10-08 12:00:00.123455" : "2026-10-08 12:00:00.123456"}::timestamp`,
    }))).returning();
    const [archived] = await db.insert(formulations).values({ organizationId: fixture.ctx.organizationId, code: "LOOKUP-ARCHIVED", name: "Archived recipe", archivedAt: new Date() }).returning();
    return { active, archived };
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
    const types = await db.insert(feedstockTypes).values([0, 1].map((index) => ({ organizationId, code: `FT-${randomUUID().slice(0, 6)}-${index}`, name: `Type ${index}`, category: "compost" as const, usage: "blend" as const }))).returning();
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
    expect(data).toHaveProperty("description", null);
    const pureResponse = await GET(lookupRequest("formulations", `/${pure.id}`, a.key), lookupParams(pure.id));
    expect((await pureResponse.json()).data).toMatchObject({ code: "FORM-PURE", biocharRatio: 1, lines: [] });
    const listed = await (await LIST(lookupRequest("formulations", "", a.key))).json();
    expect(listed.data.map((row: { id: string }) => row.id).sort()).toEqual([recipe.id, pure.id].sort());
    await lookupProblem(await GET(lookupRequest("formulations", `/${recipe.id}`, b.key), lookupParams(recipe.id)), 404, "not_found");
    await lookupProblem(await GET(lookupRequest("formulations", `/${recipe.id}`, a.missingScopeKey), lookupParams(recipe.id)), 403, "missing_scope");
  });
  it("separates active and archived pages, binds cursors and preserves detail reads with new ETags", async () => {
    const rows = await db.insert(formulations).values([0, 1, 2, 3].map(index => ({ organizationId: a.ctx.organizationId, code: `ARCHIVE-${index}`, name: `Recipe ${index}`, description: "Recipe guidance" }))).returning();
    const before = await GET(lookupRequest("formulations", `/${rows[0].id}`, a.key), lookupParams(rows[0].id));
    for (const row of rows.slice(0, 2)) await runOperationInProcess(archiveFormulationApi, a.ctx, { formulationId: row.id, expectedVersion: row.version });
    for (const archived of [false, true]) {
      const suffix = archived ? "?archived=true" : "";
      const page = await (await LIST(lookupRequest("formulations", suffix, a.key))).json();
      expect(page.data.map((row: { id: string }) => row.id).sort()).toEqual(rows.slice(archived ? 0 : 2, archived ? 2 : 4).map(row => row.id).sort());
      const first = await (await LIST(lookupRequest("formulations", `?archived=${archived}&limit=1`, a.key))).json();
      await lookupProblem(await LIST(lookupRequest("formulations", `?archived=${!archived}&cursor=${first.nextCursor}`, a.key)), 400, "invalid_cursor");
      const sameSet = await LIST(lookupRequest("formulations", `${suffix || "?archived=false"}&cursor=${first.nextCursor}`, a.key));
      expect(sameSet.status).toBe(200);
    }
    for (const identifier of [rows[0].id, rows[0].code]) {
      const detail = await GET(lookupRequest("formulations", `/${identifier}`, a.key), lookupParams(identifier));
      expect(detail.status).toBe(200);
      expect(detail.headers.get("etag")).toBe('"2.2"');
      expect(detail.headers.get("etag")).not.toBe(before.headers.get("etag"));
      expect((await detail.json()).data).toMatchObject({ description: "Recipe guidance", archivedAt: expect.any(String) });
    }
    expect((await (await LIST(lookupRequest("formulations", `?code=${rows[0].code}`, a.key))).json()).data).toEqual([]);
    expect((await (await LIST(lookupRequest("formulations", `?archived=true&code=${rows[0].code}`, a.key))).json()).data).toMatchObject([{ id: rows[0].id }]);
  });

  it("uses real key permissions to admit formulation writes independently from delete", async () => {
    const permissionKeys = [
      { key: a.key, write: false, delete: false },
      { key: (await createApiKey(a.ctx, { name: "Write fixture", scopes: ["formulations:write"], expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS })).key, write: true, delete: false },
      { key: (await createApiKey(a.ctx, { name: "Delete fixture", scopes: ["formulations:delete"], expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS })).key, write: false, delete: true },
    ];
    for (const permissions of permissionKeys) {
      const resolution = await resolveApiContext(lookupRequest("formulations", "", permissions.key), getOAuthConfig().rest);
      expect(resolution.ok).toBe(true);
      if (!resolution.ok) throw new Error("Fixture key did not resolve");
      for (const operation of ["create", "update", "archive", "restore", "delete"]) {
        const scope: ApiScope = operation === "delete" ? "formulations:delete" : "formulations:write";
        const allowed = operation === "delete" ? permissions.delete : permissions.write;
        expect(principalAllows(resolution.ctx, scope)).toBe(allowed);
        // Exercise the shared admission boundary with a stub handler.
        const handler = apiRoute(`${operation}_formulation`, scope, async () => new Response(null, { status: 204 }), { audience: "rest" });
        const response = await handler(new Request("http://localhost:3100/api/v1/formulations", { method: "POST", headers: { authorization: `Bearer ${permissions.key}` } }));
        if (allowed) expect(response.status).toBe(204);
        else await lookupProblem(response, 403, "missing_scope");
      }
    }
  });

  it("keeps the existing MCP lookup in parity for archive filters and cursors", async () => {
    await db.insert(formulations).values([0, 1].map(index => ({ organizationId: a.ctx.organizationId, code: `MCP-ARCHIVED-${index}`, name: "Archived recipe", archivedAt: new Date() })));
    const resolution = await resolveApiContext(lookupRequest("formulations", "", a.key), getOAuthConfig().rest);
    if (!resolution.ok) throw new Error("Fixture key did not resolve");
    const tool = readTools.find(tool => tool.name === "find_formulations")!;
    const rest = await (await LIST(lookupRequest("formulations", "?archived=true&limit=1", a.key))).json();
    expect(await tool.execute(resolution.ctx, { archived: true, limit: 1 })).toEqual(rest);
    const failure = await tool.execute(resolution.ctx, { cursor: rest.nextCursor })
      .catch(error => toolFailure(error, { ctx: resolution.ctx, deadlineAt: Infinity, headers: new Headers(), requestId: randomUUID(), instance: "/mcp" }, tool.name));
    expect(failure).toMatchObject({ isError: true, structuredContent: { code: "invalid_cursor" } });
    expect(await tool.execute(resolution.ctx, {})).toEqual({ data: [], nextCursor: null });
  });

});
