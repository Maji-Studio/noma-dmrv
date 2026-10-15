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
    expect(entry.methods).toEqual([...new Set([...Object.keys(operations).map((method) => method.toUpperCase()), ...(operations.get ? ["HEAD"] : []), "OPTIONS"])].sort());
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
  expect(getApiMethodEntry("/api/v1/storage-locations/OB-2/stock")).toMatchObject({
    path: "/api/v1/storage-locations/{idOrCode}/stock", scopes: ["biochar-products:read"], public: false, methods: ["GET", "HEAD", "OPTIONS"],
  });
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

it("exposes only GET, HEAD and OPTIONS for balances and customer destinations", () => {
  for (const path of ["/orders/OR-1/balance", "/customers", "/customers/CU-1", "/customers/CU-1/locations"]) {
    expect(getApiMethodEntry(`/api/v1${path}`)).toMatchObject({ public: false, methods: ["GET", "HEAD", "OPTIONS"], scopes: [path.startsWith("/orders") ? "orders:read" : "customers:read"] });
  }
});

it("exposes order writes with a separate delete scope", () => {
  expect(getApiMethodEntry("/api/v1/orders")).toMatchObject({ methods: ["GET", "HEAD", "OPTIONS", "POST"], scopes: ["orders:read", "orders:write"] });
  expect(getApiMethodEntry("/api/v1/orders/OR-1")).toMatchObject({ methods: ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH"], scopes: ["orders:read", "orders:write", "orders:delete"] });
});

it("exposes delivery creates and metadata patches without DELETE", async () => {
  expect(getApiMethodEntry("/api/v1/deliveries")).toMatchObject({ methods: ["GET", "HEAD", "OPTIONS", "POST"], scopes: ["deliveries:read", "deliveries:write"] });
  expect(getApiMethodEntry("/api/v1/deliveries/DL-1")).toMatchObject({ methods: ["GET", "HEAD", "OPTIONS", "PATCH"], scopes: ["deliveries:read", "deliveries:write"] });
  const handlers = { GET: () => Response.json({}), PATCH: () => Response.json({}) };
  const next = autoImplementMethods(handlers);
  for (const method of ["DELETE", "POST", "PUT"] as const) {
    const response = await next[method](new NextRequest("https://example.test/api/v1/deliveries/id", { method }), { params: Promise.resolve({}) });
    if (!(response instanceof Response)) throw new Error("Next must return a Response.");
    expect(response.status).toBe(405);
  }
});

it("exposes document requests and keyless confirmations without delete or edit methods", () => {
  for (const owner of ["feedstocks", "deliveries", "lab-samples"]) {
    for (const suffix of ["", "/id", "/id/content"]) {
      expect(getApiMethodEntry(`/api/v1/${owner}/CODE/documents${suffix}`)).toMatchObject({
        methods: suffix ? ["GET", "HEAD", "OPTIONS"] : ["GET", "HEAD", "OPTIONS", "POST"],
        scopes: suffix ? [`${owner}:read`] : [`${owner}:read`, `${owner}:write`], public: false,
      });
    }
    expect(getApiMethodEntry(`/api/v1/${owner}/CODE/documents/id/confirm`)).toMatchObject({
      methods: ["OPTIONS", "POST"], scopes: [`${owner}:write`], public: false,
    });
  }
});
