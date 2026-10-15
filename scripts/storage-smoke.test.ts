import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runStorageSmoke } from "./storage-smoke";

const ORIGIN = "https://staging.app.noma.maji.studio";
const PROBE_KEY = "org/_smoke/uploads/probe/test";
const mocks = vi.hoisted(() => ({
  createUploadUrl: vi.fn(),
  createDownloadUrl: vi.fn(),
  headObject: vi.fn(),
  readObjectBounded: vi.fn(),
  putObject: vi.fn(),
  deleteObject: vi.fn(),
}));

vi.mock("dotenv", () => ({ config: vi.fn() }));
vi.mock("../src/lib/storage", () => ({
  buildUploadKey: () => PROBE_KEY,
  getStorageProvider: () => ({ name: "s3", bucket: "test-bucket", ...mocks }),
}));

describe("storage smoke diagnostics", () => {
  let body: string;
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", ORIGIN);
    vi.stubEnv("CI", "");
    process.exitCode = undefined;
    body = "";
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.createUploadUrl.mockResolvedValue({
      url: "https://storage.example/probe.txt?signature=secret", method: "PUT", headers: {},
    });
    mocks.createDownloadUrl.mockResolvedValue("https://storage.example/probe.txt?signature=secret");
    mocks.headObject.mockImplementation(async () => mocks.headObject.mock.calls.length === 1
      ? { size: Buffer.byteLength(body), contentType: "text/plain", etag: "test-etag" }
      : null);
    mocks.deleteObject.mockResolvedValue(undefined);
    mocks.readObjectBounded.mockImplementation(async () => ({ bytes: Buffer.from(body), sha256: "a".repeat(64) }));
    mocks.putObject.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function mockStorage(preflightStatus: number, putOrigin: string | null, putStatus = 200) {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "OPTIONS") return new Response(null, {
        status: preflightStatus,
        headers: { "access-control-allow-origin": ORIGIN, "access-control-allow-methods": "PUT", "access-control-allow-headers": "content-type" },
      });
      if (init?.method === "PUT") {
        body = String(init.body);
        return new Response(null, { status: putStatus, headers: putOrigin ? { "access-control-allow-origin": putOrigin } : {} });
      }
      return new Response(body);
    }));
  }

  it.each([
    { preflightStatus: 403, putOrigin: ORIGIN },
    { preflightStatus: 200, putOrigin: null },
  ])("completes the round-trip and cleanup before failing CORS: %j", async ({ preflightStatus, putOrigin }) => {
    mockStorage(preflightStatus, putOrigin);
    await runStorageSmoke();
    expect(mocks.headObject).toHaveBeenCalledTimes(2);
    expect(mocks.createDownloadUrl).toHaveBeenCalledOnce();
    expect(mocks.putObject).toHaveBeenCalledWith(PROBE_KEY, expect.any(Buffer), "text/plain", { checksumSha256: "a".repeat(64) });
    expect(mocks.deleteObject).toHaveBeenCalledWith(PROBE_KEY);
    expect(console.log).toHaveBeenCalledWith("\nOK — storage round-trip passed.");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Storage CORS checks failed:"));
    expect(process.exitCode).toBe(1);
  });

  it("reports the storage failure as well as the CORS failure", async () => {
    mockStorage(403, null, 403);
    await runStorageSmoke();
    expect(console.error).toHaveBeenCalledWith("Storage CORS preflight failed (403)");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("PUT failed: 403"));
    expect(process.exitCode).toBe(1);
  });

  it.each(["http://localhost:3102", "http://127.0.0.1:3102", "http://[::1]:3102"])(
    "keeps local bucket diagnostics available without browser CORS: %s", async (origin) => {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", origin);
      mockStorage(403, null);
      await runStorageSmoke();
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(fetch).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: "OPTIONS" }));
      expect(fetch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: "PUT", headers: {} }));
      expect(mocks.headObject).toHaveBeenCalledTimes(2);
      expect(mocks.deleteObject).toHaveBeenCalledWith(PROBE_KEY);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("SKIP CORS"));
      expect(process.exitCode).toBeUndefined();
    },
  );

  it("does not skip browser CORS for a local HTTP origin in CI", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3102");
    vi.stubEnv("CI", "true");
    await expect(runStorageSmoke()).rejects.toThrow("exact HTTPS app origin");
    expect(mocks.createUploadUrl).not.toHaveBeenCalled();
  });

  it("does not skip browser CORS for a non-local HTTP origin", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://staging.app.noma.maji.studio");
    await expect(runStorageSmoke()).rejects.toThrow("exact HTTPS app origin");
    expect(mocks.createUploadUrl).not.toHaveBeenCalled();
  });
});
