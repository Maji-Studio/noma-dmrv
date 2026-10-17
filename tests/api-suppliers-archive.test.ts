import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { createApiKey } from "@/data-access/api-keys";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import { resolveApiContext } from "@/lib/auth/api-context";
import { hasRoleAndScope, type ApiScope } from "@/lib/auth/api-scopes";
import { apiRoute } from "@/lib/api/route";
import { toolFailure } from "@/lib/mcp/results";
import { readTools } from "@/lib/mcp/tools/read-tools";
import { runOperationInProcess } from "@/lib/operations/runner";
import { createLookupFixture, LOOKUP_SUITE_TIMEOUT_MS, lookupParams, lookupProblem, lookupRequest, removeLookupFixture, type LookupFixture } from "./helpers/api-lookups";
import { suppliers } from "@/db/schema";
import { GET as LIST } from "@/app/api/v1/suppliers/route";
import { GET } from "@/app/api/v1/suppliers/[idOrCode]/route";
import { archiveSupplierApi } from "@/lib/operations/supplier-api";
describe("supplier archive API", { timeout: LOOKUP_SUITE_TIMEOUT_MS }, () => {
  let a: LookupFixture;
  beforeEach(async () => { a = await createLookupFixture(); });
  afterEach(async () => { await removeLookupFixture(a); });
  it("separates active and archived pages, binds cursors and preserves detail reads with new ETags", async () => {
    const rows = await db.insert(suppliers).values([0, 1, 2, 3].map(index => ({ organizationId: a.ctx.organizationId, code: `ARCHIVE-${index}`, name: `Recipe ${index}`, sourceRegion: "Guidance" }))).returning();
    const before = await GET(lookupRequest("suppliers", `/${rows[0].id}`, a.key), lookupParams(rows[0].id));
    for (const row of rows.slice(0, 2)) await runOperationInProcess(archiveSupplierApi, a.ctx, { supplierId: row.id, expectedVersion: row.version });
    for (const archived of [false, true]) {
      const suffix = archived ? "?q=ARCHIVE-&archived=true" : "?q=ARCHIVE-";
      const page = await (await LIST(lookupRequest("suppliers", suffix, a.key))).json();
      expect(page.data.map((row: { id: string }) => row.id).sort()).toEqual(rows.slice(archived ? 0 : 2, archived ? 2 : 4).map(row => row.id).sort());
      const first = await (await LIST(lookupRequest("suppliers", `?q=ARCHIVE-&archived=${archived}&limit=1`, a.key))).json();
      await lookupProblem(await LIST(lookupRequest("suppliers", `?q=ARCHIVE-&archived=${!archived}&cursor=${first.nextCursor}`, a.key)), 400, "invalid_cursor");
      const sameSet = await LIST(lookupRequest("suppliers", `${suffix}&cursor=${first.nextCursor}`, a.key));
      expect(sameSet.status).toBe(200);
    }
    for (const identifier of [rows[0].id, rows[0].code]) {
      const detail = await GET(lookupRequest("suppliers", `/${identifier}`, a.key), lookupParams(identifier));
      expect(detail.status).toBe(200);
      expect(detail.headers.get("etag")).toBe('"2.2"');
      expect(detail.headers.get("etag")).not.toBe(before.headers.get("etag"));
      expect((await detail.json()).data).toMatchObject({ sourceRegion: "Guidance", archivedAt: expect.any(String) });
    }
    expect((await (await LIST(lookupRequest("suppliers", `?code=${rows[0].code}`, a.key))).json()).data).toEqual([]);
    expect((await (await LIST(lookupRequest("suppliers", `?archived=true&code=${rows[0].code}`, a.key))).json()).data).toMatchObject([{ id: rows[0].id }]);
  });

  it("uses real key permissions to admit supplier writes independently from delete", async () => {
    const permissionKeys = [
      { key: a.key, write: false, delete: false },
      { key: (await createApiKey(a.ctx, { name: "Write fixture", scopes: ["suppliers:write"], expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS })).key, write: true, delete: false },
      { key: (await createApiKey(a.ctx, { name: "Delete fixture", scopes: ["suppliers:delete"], expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS })).key, write: false, delete: true },
    ];
    for (const permissions of permissionKeys) {
      const resolution = await resolveApiContext(lookupRequest("suppliers", "", permissions.key));
      expect(resolution.ok).toBe(true);
      if (!resolution.ok) throw new Error("Fixture key did not resolve");
      for (const operation of ["create", "update", "archive", "restore", "delete"]) {
        const scope: ApiScope = operation === "delete" ? "suppliers:delete" : "suppliers:write";
        const allowed = operation === "delete" ? permissions.delete : permissions.write;
        expect(hasRoleAndScope(resolution.ctx, scope)).toBe(allowed);
        // Exercise the shared admission boundary before commit 3 adds the write routes.
        const handler = apiRoute(`${operation}_supplier`, scope, async () => new Response(null, { status: 204 }));
        const response = await handler(new Request("http://localhost:3100/api/v1/suppliers", { method: "POST", headers: { authorization: `Bearer ${permissions.key}` } }));
        if (allowed) expect(response.status).toBe(204);
        else await lookupProblem(response, 403, "missing_scope");
      }
    }
  });

  it("keeps the existing MCP lookup in parity for archive filters and cursors", async () => {
    await db.insert(suppliers).values([0, 1].map(index => ({ organizationId: a.ctx.organizationId, code: `MCP-ARCHIVED-${index}`, name: `Archived recipe ${index}`, archivedAt: new Date() })));
    const resolution = await resolveApiContext(lookupRequest("suppliers", "", a.key));
    if (!resolution.ok) throw new Error("Fixture key did not resolve");
    const tool = readTools.find(tool => tool.name === "find_suppliers")!;
    const rest = await (await LIST(lookupRequest("suppliers", "?archived=true&limit=1", a.key))).json();
    expect(await tool.execute(resolution.ctx, { archived: true, limit: 1 })).toEqual(rest);
    const failure = await tool.execute(resolution.ctx, { cursor: rest.nextCursor })
      .catch(error => toolFailure(error, { ctx: resolution.ctx, deadlineAt: Infinity, headers: new Headers(), requestId: randomUUID(), instance: "/mcp" }, tool.name));
    expect(failure).toMatchObject({ isError: true, structuredContent: { code: "invalid_cursor" } });
    expect(await tool.execute(resolution.ctx, { q: "MCP-ARCHIVED-" })).toEqual({ data: [], nextCursor: null });
  });

});
