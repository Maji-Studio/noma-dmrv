import { expect, it } from "vitest";
import { API_QUERY_MAX_LENGTH, API_LIST_DEFAULT_LIMIT, API_LIST_MAX_LIMIT } from "@/config/api-rest";
import { customerLocationListSchema, orderListSchema, storageLocationListSchema, creditBatchListSchema, feedstockListSchema, labSampleListSchema, productionRunListSchema, resourceQueries } from "./query-schemas";
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

it("parses customer and destination searches and refuses unknown keys", () => {
  expect(parseApiQuery(request("?q=customer&code=CU-1"), resourceQueries.customers.list)).toEqual({ limit: API_LIST_DEFAULT_LIMIT, q: "customer", code: "CU-1" });
  expect(parseApiQuery(request("?q=field"), customerLocationListSchema)).toEqual({ limit: API_LIST_DEFAULT_LIMIT, q: "field" });
  for (const schema of [resourceQueries.customers.list, customerLocationListSchema]) {
    for (const query of ["?address=x", "?q=a&q=b", "?facilityId=bad"]) expect(() => parseApiQuery(request(query), schema)).toThrow(expect.objectContaining({ code: "invalid_query" }));
  }
});

it("parses all order filters with canonical UUIDs and real calendar bounds", () => {
  const id = "df2795a4-886b-4a89-bbdd-532c6b1b8e45";
  expect(parseApiQuery(request(`?facilityId=${id.toUpperCase()}&customerId=${id.toUpperCase()}&formulationId=${id.toUpperCase()}&orderedFrom=2024-02-29&orderedBefore=2024-03-01&q=or&code=OR-1`), orderListSchema))
    .toEqual({ limit: API_LIST_DEFAULT_LIMIT, facilityId: id, customerId: id, formulationId: id, orderedFrom: "2024-02-29", orderedBefore: "2024-03-01", q: "or", code: "OR-1" });
  expect(parseApiQuery(request("?orderedFrom=0100-01-01&orderedBefore=9999-12-31"), orderListSchema)).toMatchObject({ orderedFrom: "0100-01-01", orderedBefore: "9999-12-31" });
  for (const date of ["0020-02-29", "0001-01-01", "2000-02-29"]) {
    expect(parseApiQuery(request(`?orderedFrom=${date}&orderedBefore=${date}`), orderListSchema)).toMatchObject({ orderedFrom: date, orderedBefore: date });
  }
  for (const field of ["orderedFrom", "orderedBefore"]) {
    for (const date of ["0021-02-29", "1900-02-29"]) {
      expect(() => parseApiQuery(request(`?${field}=${date}`), orderListSchema)).toThrow(expect.objectContaining({ code: "invalid_query" }));
    }
  }
  for (const query of ["?customerId=bad", "?formulationId=bad", "?status=fulfilled", "?orderedFrom=2026-02-29", "?orderedBefore=2026-04-31", "?orderedFrom=0000-01-01", "?orderedBefore=10000-01-01", "?orderedFrom=2026-01-01T00:00:00Z", "?orderedFrom=2026-01-01&orderedFrom=2026-01-02"]) {
    expect(() => parseApiQuery(request(query), orderListSchema)).toThrow(expect.objectContaining({ code: "invalid_query" }));
  }
});

it("parses storage-location lane and formulation filters", () => {
  const id = "df2795a4-886b-4a89-bbdd-532c6b1b8e45";
  expect(parseApiQuery(request(`?type=product_bin&formulationId=${id.toUpperCase()}`), storageLocationListSchema))
    .toEqual({ limit: API_LIST_DEFAULT_LIMIT, type: "product_bin", formulationId: id });
  for (const query of ["?type=product", "?formulationId=bad", "?status=active", "?type=biochar_bin&type=product_bin"]) {
    expect(() => parseApiQuery(request(query), storageLocationListSchema)).toThrow(expect.objectContaining({ code: "invalid_query" }));
  }
});
