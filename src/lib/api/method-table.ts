import type { ApiScope } from "@/lib/auth/api-scopes";
import { buildOpenApiDocument } from "./openapi/document";

const API_PREFIX = "/api/v1";
const HTTP_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE"]);
const isParameter = (segment: string) => /^\{[^{}]+\}$/.test(segment);
const pathSegments = (path: string) => path.replace(/\/$/, "").split("/");

export interface ApiMethodEntry {
  path: string;
  segments: string[];
  methods: string[];
  public: boolean;
  scopes: (ApiScope | null)[];
}

/** The published operations are the authority; Next also implements HEAD and OPTIONS. */
export function buildApiMethodTable(paths: ReturnType<typeof buildOpenApiDocument>["paths"]): ApiMethodEntry[] {
  return Object.entries(paths).map(([path, operations]) => {
    const entries = Object.entries(operations).filter(([method]) => HTTP_METHODS.has(method.toUpperCase()));
    const methods = new Set(entries.map(([method]) => method.toUpperCase()));
    if (methods.has("GET")) methods.add("HEAD");
    methods.add("OPTIONS");
    return {
      path: `${API_PREFIX}${path}`,
      segments: pathSegments(`${API_PREFIX}${path}`),
      methods: [...methods].sort(),
      public: entries.some(([, operation]) => operation.security?.length === 0),
      scopes: [...new Set(entries.map(([, operation]) => operation["x-required-scope"]))],
    };
  }).sort((a, b) => a.segments.filter(isParameter).length - b.segments.filter(isParameter).length);
}

export function matchApiMethodEntry(table: readonly ApiMethodEntry[], pathname: string): ApiMethodEntry | undefined {
  const segments = pathSegments(pathname);
  return table.find((entry) => entry.segments.length === segments.length && entry.segments.every((segment, index) =>
    isParameter(segment) ? segments[index].length > 0 : segment === segments[index],
  ));
}

let methodTable: ApiMethodEntry[] | undefined;
export function getApiMethodEntry(pathname: string): ApiMethodEntry | undefined {
  methodTable ??= buildApiMethodTable(buildOpenApiDocument().paths);
  return matchApiMethodEntry(methodTable, pathname);
}

export function isV1ApiPath(pathname: string): boolean {
  return pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`);
}
