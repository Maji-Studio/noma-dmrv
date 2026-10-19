import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/config/env", () => { throw new Error("app config must not load"); });
import { getIsometricClientFromEnv } from "./index";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("CI", undefined);
  vi.stubEnv("NOMA_HERMETIC_CI", undefined);
  vi.stubEnv("NEXT_PUBLIC_APP_URL", undefined);
  vi.stubEnv("ISOMETRIC_CLIENT_SECRET", "test-secret");
  vi.stubEnv("ISOMETRIC_ACCESS_TOKEN", "test-token");
  vi.stubEnv("ISOMETRIC_ENVIRONMENT", undefined);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset().mockResolvedValue(new Response("{}"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("standalone Isometric environment", () => {
  it("rejects an unset selector in production with valid credentials", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => getIsometricClientFromEnv()).toThrow("ISOMETRIC_ENVIRONMENT must be set explicitly in production");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["sandbox", "production"] as const)("accepts explicit %s in production", async (environment) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ISOMETRIC_ENVIRONMENT", environment);
    await getIsometricClientFromEnv().get("/projects");
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.${environment === "production" ? "" : "sandbox."}isometric.com/mrv/v0/projects`,
      expect.any(Object),
    );
  });

  it.each([
    ["true", "http://localhost:3100"],
    ["1", "https://127.0.0.1:3100"],
    ["TRUE", "http://[::1]:3100"],
  ])("allows the sandbox default in hermetic CI (%s, %s)", async (ci, appUrl) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CI", ci);
    vi.stubEnv("NOMA_HERMETIC_CI", "true");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", appUrl);
    await getIsometricClientFromEnv().get("/projects");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.sandbox.isometric.com/mrv/v0/projects",
      expect.any(Object),
    );
  });

  it.each([
    [undefined, "true", "http://localhost:3100"],
    ["TRUE", "true", "http://localhost:3100"],
    ["true", undefined, "http://localhost:3100"],
    ["true", "false", "http://localhost:3100"],
    ["true", "true", "https://example.com"],
    ["true", "true", "ftp://localhost"],
    ["true", "true", "invalid"],
    ["true", "true", undefined],
  ])("rejects an incomplete hermetic CI exception (%s, %s, %s)", (marker, ci, appUrl) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NOMA_HERMETIC_CI", marker);
    vi.stubEnv("CI", ci);
    vi.stubEnv("NEXT_PUBLIC_APP_URL", appUrl);
    expect(() => getIsometricClientFromEnv()).toThrow("ISOMETRIC_ENVIRONMENT must be set explicitly in production");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([undefined, "sandbox", "production"] as const)("preserves credentials and URLs for %s", async (environment) => {
    vi.stubEnv("ISOMETRIC_ENVIRONMENT", environment);
    await getIsometricClientFromEnv().post("/projects", { example: true });
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.${environment === "production" ? "" : "sandbox."}isometric.com/mrv/v0/projects`,
      expect.objectContaining({
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Client-Secret": "test-secret",
          Authorization: "Bearer test-token",
        },
        body: JSON.stringify({ example: true }),
      }),
    );
  });

  it.each([undefined, "", "  "])("preserves not_configured for absent/blank credentials (%s)", async (value) => {
    vi.stubEnv("ISOMETRIC_CLIENT_SECRET", value);
    vi.stubEnv("ISOMETRIC_ACCESS_TOKEN", value);
    await expect(getIsometricClientFromEnv().get("/projects")).rejects.toMatchObject({ code: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["ISOMETRIC_CLIENT_SECRET", "ISOMETRIC_ACCESS_TOKEN"])("rejects a missing half of the pair: %s", (key) => {
    vi.stubEnv(key, undefined);
    expect(() => getIsometricClientFromEnv()).toThrow("must either both be set or both be omitted");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid environment before any request", () => {
    vi.stubEnv("ISOMETRIC_ENVIRONMENT", "typo");
    expect(() => getIsometricClientFromEnv()).toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
