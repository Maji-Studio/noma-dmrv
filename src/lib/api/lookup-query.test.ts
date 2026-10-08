import { describe, expect, it, vi } from "vitest";
import { API_LIST_DEFAULT_LIMIT, API_LIST_MAX_LIMIT } from "@/config/api-rest";
import type { ApiContext } from "@/lib/auth/api-context";
import { decodeCursor, encodeCursor } from "./cursor";
import {
  facilityLookupGetSchema, facilityLookupListSchema, lookupGetSchema, lookupIdentifier, lookupListSchema,
  parseApiQuery, readLookupPage, supplierLocationListSchema,
} from "./lookup-query";

const id = "4d766880-6bb2-4dcb-ad62-e00c04bcbb4b";
const otherId = "4d766880-6bb2-4dcb-ad62-e00c04bcbb4c";
const ctx = { organizationId: "org-a" } as ApiContext;
const request = (query: string) => new Request(`http://localhost/api/v1/facilities${query}`);

it("identifies UUIDs as ids and all other segments as exact codes", () => {
  expect(lookupIdentifier(id)).toEqual({ id });
  expect(lookupIdentifier("FAC-001")).toEqual({ code: "FAC-001" });
});

describe("lookup query contract", () => {
  it("uses configured default and maximum limits and rejects unknown or repeated keys", () => {
    expect(parseApiQuery(request(""), lookupListSchema)).toEqual({ limit: API_LIST_DEFAULT_LIMIT });
    expect(parseApiQuery(request(`?limit=${API_LIST_MAX_LIMIT}`), lookupListSchema).limit).toBe(API_LIST_MAX_LIMIT);
    for (const query of ["?other=1", "?limit=0", "?limit=-1", "?limit=1.5", "?limit=01", `?limit=${API_LIST_MAX_LIMIT + 1}`, "?q=a&q=b", "?facilityId=bad"]) {
      expect(() => parseApiQuery(request(query), lookupListSchema)).toThrow(expect.objectContaining({ status: 400, code: "invalid_query" }));
    }
  });
  it("permits facilityId only for facility resources and accepts only name search for locations", () => {
    expect(parseApiQuery(request(`?facilityId=${id}`), facilityLookupListSchema).facilityId).toBe(id);
    expect(parseApiQuery(request(`?facilityId=${id}`), facilityLookupGetSchema)).toEqual({ facilityId: id });
    expect(() => parseApiQuery(request("?q=any"), lookupGetSchema)).toThrow();
    expect(() => parseApiQuery(request("?code=any"), supplierLocationListSchema)).toThrow();
    expect(parseApiQuery(request("?q=orchard"), supplierLocationListSchema)).toEqual({ limit: API_LIST_DEFAULT_LIMIT, q: "orchard" });
  });
});

it("returns only the requested page and preserves the last row's timestamp microseconds", async () => {
  const filters = { q: "wood" };
  const row = { id, cursorCreatedAt: "2026-10-08T12:00:00.123456Z" };
  const list = vi.fn().mockResolvedValue([row, { id: otherId, cursorCreatedAt: "2026-10-08T12:00:00.123455Z" }]);
  const represent = (entry: typeof row) => ({ id: entry.id });
  const first = await readLookupPage(ctx, "facilities", { limit: 1, filters }, list, represent);
  expect(first.data).toEqual([{ id }]);
  expect(list).toHaveBeenCalledWith(ctx, filters, 1, undefined);
  const binding = { organizationId: ctx.organizationId, resource: "facilities", filters };
  expect(decodeCursor(first.nextCursor!, binding)).toEqual({ id, createdAt: row.cursorCreatedAt });
  list.mockResolvedValue([]);
  expect(await readLookupPage(ctx, "facilities", { limit: 1, filters, cursor: first.nextCursor! }, list, represent)).toEqual({ data: [], nextCursor: null });
  expect(list).toHaveBeenLastCalledWith(ctx, filters, 1, { id, createdAt: row.cursorCreatedAt });
});

it("rejects a cursor bound to another resource, organization, filter or parent before querying", async () => {
  const filters = { supplierId: id, q: "wood" };
  const binding = { organizationId: "org-a", resource: "supplier-locations", filters };
  const cursor = encodeCursor({ id, createdAt: "2026-10-08T12:00:00.123456Z" }, binding);
  const list = vi.fn().mockResolvedValue([]);
  for (const [organizationId, resource, boundFilters] of [
    ["org-b", binding.resource, filters], ["org-a", "facilities", filters],
    ["org-a", binding.resource, { ...filters, supplierId: otherId }], ["org-a", binding.resource, { ...filters, q: "changed" }],
  ] as const) {
    await expect(readLookupPage({ ...ctx, organizationId }, resource, { limit: 1, cursor, filters: boundFilters }, list, (row) => row))
      .rejects.toMatchObject({ status: 400, code: "invalid_cursor" });
  }
  expect(list).not.toHaveBeenCalled();
});
