import { describe, expect, it, vi } from "vitest";
import { assertUploadCors, withUploadCorsRule, appOrigin } from "./storage-cors-core";

const ORIGIN = "https://staging.app.noma.maji.studio";
const URL = "https://fra1.digitaloceanspaces.com/bucket/probe.csv?signature=secret";

describe("browser upload CORS", () => {
  it("rejects the observed stale-origin preflight denial", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 403 }));
    await expect(assertUploadCors(URL, ORIGIN, fetcher)).rejects.toThrow("preflight failed (403)");
    expect(fetcher).toHaveBeenCalledWith(URL, expect.objectContaining({
      method: "OPTIONS",
      headers: { Origin: ORIGIN, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type" },
    }));
  });

  it.each<Record<string, string>>([
    {},
    { "Access-Control-Allow-Origin": "https://staging.noma.maji.studio" },
    { "Access-Control-Allow-Origin": ORIGIN, "Access-Control-Allow-Methods": "GET" },
    { "Access-Control-Allow-Origin": ORIGIN, "Access-Control-Allow-Methods": "PUT", "Access-Control-Allow-Headers": "authorization" },
  ])("rejects incomplete or mismatched CORS responses", async (headers) => {
    await expect(assertUploadCors(URL, ORIGIN, vi.fn().mockResolvedValue(new Response(null, { headers })))).rejects.toThrow(/CORS/);
  });

  it("accepts the browser's exact origin, method and header", async () => {
    await expect(assertUploadCors(URL, ORIGIN, vi.fn().mockResolvedValue(new Response(null, { headers: {
      "Access-Control-Allow-Origin": ORIGIN,
      "Access-Control-Allow-Methods": "GET, PUT, HEAD",
      "Access-Control-Allow-Headers": "Content-Type",
    } })))).resolves.toBeUndefined();
  });

  it("adds only the exact app origin and preserves existing shared-bucket rules", () => {
    const old = { AllowedOrigins: ["https://staging.noma.maji.studio"], AllowedMethods: ["PUT"], AllowedHeaders: ["*"] };
    const rules = withUploadCorsRule([old], ORIGIN);
    expect(rules).toHaveLength(2);
    expect(rules[0]).toMatchObject({ AllowedOrigins: [ORIGIN], AllowedMethods: ["PUT"], AllowedHeaders: ["Content-Type"] });
    expect(rules[1]).toEqual(old);
    expect(withUploadCorsRule(rules, ORIGIN)).toEqual(rules);
  });

  it.each(["http://example.com", "https://*.example.com", "https://user:password@example.com", "https://example.com/path", "https://example.com?token=x"])("rejects unsafe deployed origins: %s", (url) => {
    expect(() => appOrigin(url)).toThrow();
  });
});
