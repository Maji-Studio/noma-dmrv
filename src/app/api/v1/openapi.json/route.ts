import { API_DOCS_CACHE_SECONDS } from "@/config/api-rest";
import { serializeOpenApiDocument } from "@/lib/api/openapi/document";

export const runtime = "nodejs";

/** Public contract discovery intentionally bypasses the private API harness. */
export function GET() {
  return new Response(serializeOpenApiDocument(), { headers: {
    "Content-Type": "application/json",
    "Cache-Control": `public, max-age=${API_DOCS_CACHE_SECONDS}`,
  } });
}
