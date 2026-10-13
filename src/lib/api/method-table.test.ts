import { autoImplementMethods } from "next/dist/server/route-modules/app-route/helpers/auto-implement-methods";
import { NextRequest } from "next/server";
import { expect, it } from "vitest";
import { buildOpenApiDocument } from "./openapi/document";
import { buildApiMethodTable, getApiMethodEntry, isV1ApiPath, matchApiMethodEntry } from "./method-table";

const document = buildOpenApiDocument();
const table = buildApiMethodTable(document.paths);

it("derives every path and matches Next's actual automatic methods and Allow", async () => {
  expect(table).toHaveLength(Object.keys(document.paths).length);
  for (const [path, operations] of Object.entries(document.paths)) {
    const GET = () => Response.json({ ok: true });
    const handlers = Object.fromEntries(Object.keys(operations).map((method) => [method.toUpperCase(), GET]));
    const next = autoImplementMethods(handlers);
    const entry = table.find((entry) => entry.path === `/api/v1${path}`)!;
    const options = await next.OPTIONS(new NextRequest(`https://example.test${entry.path}`), { params: Promise.resolve({}) });
    if (!(options instanceof Response)) throw new Error("Next OPTIONS must return a Response.");
    expect(entry.methods.join(", ")).toBe(options.headers.get("Allow"));
    if (operations.get) expect(next.HEAD).toBe(handlers.GET);
    expect(entry.methods).toEqual([...new Set([...Object.keys(operations).map((method) => method.toUpperCase()), "HEAD", "OPTIONS"])].sort());
  }
});

it("picks static paths before parameters and accepts only whole nonempty parameter segments", () => {
  const operation = document.paths["/me"].get;
  const future = buildApiMethodTable({
    "/products/{idOrCode}": { get: operation, patch: operation },
    "/products/search": { post: operation },
    "/production-runs": { post: operation },
  });
  expect(matchApiMethodEntry(future, "/api/v1/products/search")?.methods).toEqual(["OPTIONS", "POST"]);
  expect(matchApiMethodEntry(future, "/api/v1/products/a.b+code/")?.methods).toEqual(["GET", "HEAD", "OPTIONS", "PATCH"]);
  expect(matchApiMethodEntry(future, "/api/v1/production-runs")?.methods).toEqual(["OPTIONS", "POST"]);
  for (const path of ["/api/v1/products/", "/api/v1/products//", "/api/v1/products/a/extra", "/api/v1x/products/a"]) {
    expect(matchApiMethodEntry(future, path)).toBeUndefined();
  }
});

it("recognizes nested supplier locations, exact public docs, scopes and the v1 boundary", () => {
  expect(getApiMethodEntry("/api/v1/suppliers/SUP-1/locations")).toMatchObject({
    path: "/api/v1/suppliers/{idOrCode}/locations", scopes: ["suppliers:read"], public: false,
  });
  expect(getApiMethodEntry("/api/v1/feedstocks/FS-1")?.scopes).toEqual(["feedstocks:read", "feedstocks:write", "feedstocks:delete"]);
  expect(getApiMethodEntry("/api/v1/me")).toMatchObject({ scopes: [null], public: false });
  for (const path of ["/api/v1/openapi.json", "/api/v1/llms.txt"]) {
    expect(getApiMethodEntry(path)).toMatchObject({ public: true, methods: ["GET", "HEAD", "OPTIONS"] });
    expect(getApiMethodEntry(`${path}/extra`)).toBeUndefined();
  }
  expect(isV1ApiPath("/api/v1")).toBe(true);
  expect(isV1ApiPath("/api/v1/me")).toBe(true);
  expect(isV1ApiPath("/api/v1x/me")).toBe(false);
  expect(isV1ApiPath("/facilities")).toBe(false);
});
