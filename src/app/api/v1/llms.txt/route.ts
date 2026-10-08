import { API_DOCS_CACHE_SECONDS } from "@/config/api-rest";
import { llmsGuide } from "@/lib/api/llms-guide";

export const runtime = "nodejs";

/** Public agent guidance intentionally bypasses credential resolution and limits. */
export function GET() {
  return new Response(llmsGuide, { headers: {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": `public, max-age=${API_DOCS_CACHE_SECONDS}`,
  } });
}
