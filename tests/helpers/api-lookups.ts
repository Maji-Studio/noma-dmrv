import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { drivers, members, supplierLocations, users, vehicles } from "@/db/schema";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import { API_LIST_MAX_LIMIT } from "@/config/api-rest";
import { createApiKey } from "@/data-access/api-keys";
import { API_SCOPES } from "@/lib/auth/api-scopes";
import { createIntakeFixture, removeIntakeFixture, type IntakeFixture } from "./operation-fixture";

export const LOOKUP_SUITE_TIMEOUT_MS = 30_000;
export const LOOKUP_PAGE_LIMIT = 2;
export const LOOKUP_CODES = ["LOOKUP-%_\\literal", "LOOKUP-TWO", "LOOKUP-THREE"];
export const LOOKUP_IDS = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
  "10000000-0000-4000-8000-000000000003",
];
export const LOOKUP_ARCHIVE_INSTANT = new Date("2026-10-08T12:00:00.000Z");

export interface LookupFixture extends IntakeFixture { key: string; missingScopeKey: string }
export async function createLookupFixture(): Promise<LookupFixture> {
  const fixture = await createIntakeFixture(`lookup-${randomUUID()}`);
  await db.insert(users).values({ id: fixture.ctx.userId, email: `${fixture.ctx.userId}@example.test`, name: "REST fixture", emailVerified: true });
  await db.insert(members).values({ id: randomUUID(), organizationId: fixture.ctx.organizationId, userId: fixture.ctx.userId, role: "owner" });
  const key = (await createApiKey(fixture.ctx, {
    name: "Lookup fixture", scopes: API_SCOPES.filter((scope) => scope.endsWith(":read")), expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS,
  })).key;
  const missingScopeKey = (await createApiKey(fixture.ctx, {
    name: "Other scope", scopes: ["feedstocks:read"], expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS,
  })).key;
  return { ...fixture, key, missingScopeKey };
}

export async function removeLookupFixture(fixture: LookupFixture) {
  for (const table of [supplierLocations, vehicles, drivers]) {
    await db.delete(table).where(eq(table.organizationId, fixture.ctx.organizationId));
  }
  await removeIntakeFixture(fixture);
  await db.delete(users).where(eq(users.id, fixture.ctx.userId));
}

export function lookupRequest(resource: string, path: string, key: string) {
  return new Request(`http://localhost:3100/api/v1/${resource}${path}`, { headers: { authorization: `Bearer ${key}` } });
}
export const lookupParams = (idOrCode: string) => ({ params: Promise.resolve({ idOrCode }) });
export async function lookupProblem(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("content-type")).toContain("application/problem+json");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-request-id")).toBeTruthy();
  const body = await response.json();
  expect(body.code).toBe(code);
  return body;
}

interface LookupRow { id: string; code: string; name: string; version: number; archivedAt?: Date | null }
interface LookupContract {
  resource: string;
  list: (request: Request) => Promise<Response>;
  get: (request: Request, params: ReturnType<typeof lookupParams>) => Promise<Response>;
  seed: (fixture: LookupFixture) => Promise<{ active: LookupRow[]; archived?: LookupRow }>;
}

/** Real API keys, route handlers and Postgres; each contract owns its organizations. */
export function lookupContract({ resource, list, get, seed }: LookupContract) {
  describe(`${resource} lookup REST contract`, { timeout: LOOKUP_SUITE_TIMEOUT_MS }, () => {
    let a: LookupFixture;
    let b: LookupFixture;
    let rows: Awaited<ReturnType<LookupContract["seed"]>>;
    const request = (path: string, key = a.key) => lookupRequest(resource, path, key);
    beforeEach(async () => {
      a = await createLookupFixture();
      b = await createLookupFixture();
      rows = await seed(a);
    });
    afterEach(async () => {
      await removeLookupFixture(a);
      await removeLookupFixture(b);
    });

    it("finds code and name prefixes, exact codes and literal LIKE metacharacters", async () => {
      for (const q of ["lookup-", "lookup name"]) {
        const response = await list(request(`?q=${encodeURIComponent(q)}`));
        expect(response.status).toBe(200);
        const { data } = await response.json();
        expect(data.map((row: LookupRow) => ({ id: row.id, version: row.version })).sort((a: LookupRow, b: LookupRow) => a.id.localeCompare(b.id))).toEqual(
          rows.active.map((row) => ({ id: row.id, version: row.version })).sort((a, b) => a.id.localeCompare(b.id)),
        );
      }
      const row = rows.active[0];
      for (const filter of [`code=${encodeURIComponent(row.code)}`, `q=${encodeURIComponent(row.code.toLowerCase())}`]) {
        const response = await list(request(`?${filter}`));
        expect(response.status).toBe(200);
        expect((await response.json()).data.map((item: LookupRow) => item.id)).toEqual([row.id]);
      }
      for (const q of ["%", "_", "\\", "name"]) {
        expect((await (await list(request(`?q=${encodeURIComponent(q)}`))).json()).data).toEqual([]);
      }
      expect((await (await list(request("?code=missing"))).json()).data).toEqual([]);
    });

    it("gets by id and code, returning archive timestamps, versions and strong ETags", async () => {
      for (const row of [...rows.active, ...(rows.archived ? [rows.archived] : [])]) {
        for (const identifier of [row.id, row.code]) {
          const response = await get(request(`/${encodeURIComponent(identifier)}`), lookupParams(identifier));
          expect(response.status).toBe(200);
          expect(response.headers.get("cache-control")).toBe("private, no-store");
          expect(response.headers.get("x-request-id")).toBeTruthy();
          expect(response.headers.get("etag")).toBe(`"${row.version}.1"`);
          const { data } = await response.json();
          expect(data).toMatchObject({ id: row.id, code: row.code, name: row.name, version: row.version, archivedAt: row.archivedAt?.toISOString() ?? null });
          for (const field of ["organizationId", "contactName", "contactEmail", "contactPhone", "licenseNumber"]) expect(data).not.toHaveProperty(field);
        }
      }
      await lookupProblem(await get(request("/missing"), lookupParams("missing")), 404, "not_found");
    });

    it("paginates timestamps at microsecond precision and breaks ties by UUID", async () => {
      const firstResponse = await list(request(`?q=lookup&limit=${LOOKUP_PAGE_LIMIT}`));
      expect(firstResponse.status).toBe(200);
      const first = await firstResponse.json();
      expect(first.data.map((row: LookupRow) => row.id)).toEqual([LOOKUP_IDS[2], LOOKUP_IDS[1]]);
      expect(first.nextCursor).toBeTruthy();
      expect(first).not.toHaveProperty("total");
      const second = await (await list(request(`?q=lookup&limit=${LOOKUP_PAGE_LIMIT}&cursor=${first.nextCursor}`))).json();
      expect(second.data.map((row: LookupRow) => row.id)).toEqual([LOOKUP_IDS[0]]);
      expect(second.nextCursor).toBeNull();
      await lookupProblem(await list(request(`?q=changed&cursor=${first.nextCursor}`)), 400, "invalid_cursor");
      await lookupProblem(await list(request(`?q=lookup&cursor=${first.nextCursor}`, b.key)), 400, "invalid_cursor");
    });

    it("refuses foreign ids, codes and credentials without the resource scope", async () => {
      for (const identifier of [rows.active[0].id, rows.active[0].code, ...(rows.archived ? [rows.archived.id, rows.archived.code] : [])]) {
        await lookupProblem(await get(request(`/${encodeURIComponent(identifier)}`, b.key), lookupParams(identifier)), 404, "not_found");
      }
      expect((await (await list(request("?q=lookup", b.key))).json()).data).toEqual([]);
      await lookupProblem(await list(request("", a.missingScopeKey)), 403, "missing_scope");
      await lookupProblem(await get(request(`/${rows.active[0].id}`, a.missingScopeKey), lookupParams(rows.active[0].id)), 403, "missing_scope");
    });

    it("rejects invalid, repeated and unknown queries on list and get", async () => {
      for (const query of [`?limit=${API_LIST_MAX_LIMIT + 1}`, "?limit=0", "?limit=1&limit=2", "?unknown=true", "?cursor=bad", "?q=a&q=b"]) {
        await lookupProblem(await list(request(query)), 400, query === "?cursor=bad" ? "invalid_cursor" : "invalid_query");
      }
      await lookupProblem(await get(request(`/${rows.active[0].id}?q=a`), lookupParams(rows.active[0].id)), 400, "invalid_query");
    });
  });
}
