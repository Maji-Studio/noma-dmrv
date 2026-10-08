import { randomUUID } from "node:crypto";
import { API_DOCS_CACHE_SECONDS } from "@/config/api-rest";
import { getSerializedOpenApiDocument } from "@/lib/api/openapi/document";

export const runtime = "nodejs";

/** Public contract discovery intentionally bypasses the private API harness. */
export function GET() {
  return new Response(getSerializedOpenApiDocument(), { headers: {
    "Content-Type": "application/json",
    "Cache-Control": `public, max-age=${API_DOCS_CACHE_SECONDS}`,
    "X-Request-Id": randomUUID(),
  } });
}
