import { expect, it } from "vitest";
import { API_QUERY_MAX_LENGTH, API_LIST_DEFAULT_LIMIT, API_LIST_MAX_LIMIT } from "@/config/api-rest";
import { creditBatchListSchema, feedstockListSchema, labSampleListSchema, productionRunListSchema, resourceQueries } from "./query-schemas";
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
  expect(parseApiQuery(request("?q=pr-26"), productionRunListSchema)).toEqual({ limit: API_LIST_DEFAULT_LIMIT, q: "pr-26" });
  const id = "df2795a4-886b-4a89-bbdd-532c6b1b8e45";
  expect(parseApiQuery(request(`?facilityId=${id}&reactorId=${id}&status=running&code=PR-26-0001&limit=2`), productionRunListSchema))
    .toEqual({ facilityId: id, reactorId: id, status: "running", code: "PR-26-0001", limit: 2 });
  for (const query of ["?status=completed", "?reactorId=bad", "?q=run&q=other", `?q=${"x".repeat(API_QUERY_MAX_LENGTH + 1)}`, "?status=complete&status=running", "?limit=201"]) {
    expect(() => parseApiQuery(request(query), productionRunListSchema)).toThrow(expect.objectContaining({ code: "invalid_query" }));
  }
});

it("parses lab sample filters, canonicalizing UUIDs and requiring offset instants", () => {
  const id = "df2795a4-886b-4a89-bbdd-532c6b1b8e45";
  expect(labSampleListSchema.shape.limit).toBe(feedstockListSchema.shape.limit);
  expect(parseApiQuery(request(`?creditBatchId=${id.toUpperCase()}&facilityId=${id.toUpperCase()}&code=SAM-1&q=sam&sampledFrom=2026-09-12T12:00:00Z&sampledBefore=2026-09-13T12:00:00%2B03:00`), labSampleListSchema))
    .toMatchObject({ creditBatchId: id, facilityId: id, code: "SAM-1", q: "sam", sampledFrom: "2026-09-12T12:00:00Z", sampledBefore: "2026-09-13T12:00:00+03:00" });
  for (const query of ["?creditBatchId=bad", "?sampledFrom=2026-09-12T12:00:00", "?sampledBefore=2026-09-12", "?status=pending", "?q=a&q=b"]) {
    expect(() => parseApiQuery(request(query), labSampleListSchema)).toThrow(expect.objectContaining({ code: "invalid_query" }));
  }
});

it("parses credit batch filters against the status and sampling vocabularies", () => {
  expect(parseApiQuery(request("?status=pending&sampling=sampled&code=CB-1"), creditBatchListSchema))
    .toEqual({ limit: API_LIST_DEFAULT_LIMIT, status: "pending", sampling: "sampled", code: "CB-1" });
  for (const query of ["?status=archived", "?sampling=maybe", "?creditBatchId=x", "?status=draft&status=pending"]) {
    expect(() => parseApiQuery(request(query), creditBatchListSchema)).toThrow(expect.objectContaining({ code: "invalid_query" }));
  }
});
