import { expect, it } from "vitest";
import { API_LIST_DEFAULT_LIMIT, API_LIST_MAX_LIMIT } from "@/config/api-rest";
import { feedstockListSchema, productionRunListSchema, resourceQueries } from "./query-schemas";
import { parseApiQuery } from "./query";

const request = (query: string) => new Request(`https://example.test/api/v1/feedstocks${query}`);
it("preserves feedstock query decoding and strict unknown/repeated parameter rejection", () => {
  expect(parseApiQuery(request(""), feedstockListSchema)).toEqual({ limit: API_LIST_DEFAULT_LIMIT });
  expect(parseApiQuery(request(`?limit=${API_LIST_MAX_LIMIT}&q=FS-26-&code=FS-26-0231`), feedstockListSchema))
    .toEqual({ limit: API_LIST_MAX_LIMIT, q: "FS-26-", code: "FS-26-0231" });
  expect(parseApiQuery(request("?facilityId=df2795a4-886b-4a89-bbdd-532c6b1b8e45"), feedstockListSchema))
    .toMatchObject({ facilityId: "df2795a4-886b-4a89-bbdd-532c6b1b8e45" });
  for (const query of ["?include=supplier", "?facilityId=bad", "?limit=0", "?limit=01", "?limit=1.5", `?limit=${API_LIST_MAX_LIMIT + 1}`, "?q=wood&q=chips"]) {
    expect(() => parseApiQuery(request(query), feedstockListSchema)).toThrow(expect.objectContaining({ status: 400, code: "invalid_query" }));
  }
});

it("reuses pagination and exact-code schemas for production runs and reactors", () => {
  expect(productionRunListSchema.shape.limit).toBe(feedstockListSchema.shape.limit);
  expect(productionRunListSchema.shape.code).toBe(feedstockListSchema.shape.code);
  expect(resourceQueries.reactors.list.shape.q).toBe(resourceQueries["storage-locations"].list.shape.q);
  const id = "df2795a4-886b-4a89-bbdd-532c6b1b8e45";
  expect(parseApiQuery(request(`?facilityId=${id}&reactorId=${id}&status=running&code=PR-26-0001&limit=2`), productionRunListSchema))
    .toEqual({ facilityId: id, reactorId: id, status: "running", code: "PR-26-0001", limit: 2 });
  for (const query of ["?status=completed", "?reactorId=bad", "?q=run", "?status=draft&status=running", "?limit=201"]) {
    expect(() => parseApiQuery(request(query), productionRunListSchema)).toThrow(expect.objectContaining({ code: "invalid_query" }));
  }
});
