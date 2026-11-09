import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchFonts, FONT_FILES, signGetRequest } from "../scripts/fetch-fonts.mjs";

const SCRIPT_PATH = resolve(import.meta.dirname, "../scripts/fetch-fonts.mjs");
const CLI_TIMEOUT_MS = 10_000;
const HTTP_FORBIDDEN = 403;
const EXIT_SUCCESS = 0;
const EXIT_FAILURE = 1;
const FETCH_CYCLES = 2;
// Public AWS example data, never real credentials. API Reference, printed pages 25-26:
// https://awsdocs.s3.amazonaws.com/S3/latest/s3-api.pdf#page=29
const EXAMPLE_ACCESS_KEY = "AKIAIOSFODNN7EXAMPLE";
const EXAMPLE_SECRET_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const EXAMPLE_SIGNATURE = "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41";
const TEST_ENV = {
  FONTS_S3_ACCESS_KEY_ID: EXAMPLE_ACCESS_KEY,
  FONTS_S3_SECRET_ACCESS_KEY: EXAMPLE_SECRET_KEY,
  FONTS_S3_ENDPOINT: "http://localhost:9999",
};

it("matches the published AWS SigV4 GET Object signature", () => {
  const headers = signGetRequest({
    url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
    region: "us-east-1",
    accessKeyId: EXAMPLE_ACCESS_KEY,
    secretAccessKey: EXAMPLE_SECRET_KEY,
    now: new Date("2013-05-24T00:00:00Z"),
    range: "bytes=0-9",
  });
  expect(headers.authorization).toBe(
    `AWS4-HMAC-SHA256 Credential=${EXAMPLE_ACCESS_KEY}/20130524/us-east-1/s3/aws4_request, `
    + `SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=${EXAMPLE_SIGNATURE}`,
  );
});

describe("licensed font fetch", () => {
  let directory: string;
  let request: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "noma-fonts-"));
    request = vi.fn<typeof fetch>().mockImplementation(async () => new Response("font fixture"));
    vi.stubGlobal("fetch", request);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  async function populate() {
    await Promise.all(FONT_FILES.map((file) => writeFile(join(directory, file), "cached font")));
  }

  function runCli(args: string[], env: Record<string, string | undefined> = {}, setup?: string) {
    return spawnSync(process.execPath, [
      ...(setup ? ["--import", `data:text/javascript,${encodeURIComponent(setup)}`] : []),
      SCRIPT_PATH, ...args,
    ], { cwd: directory, env: { NODE_ENV: "test", PATH: process.env.PATH, ...env }, encoding: "utf8", timeout: CLI_TIMEOUT_MS });
  }

  it("exits successfully without credentials and accepts a relative output directory", () => {
    const result = runCli(["--out", "missing/fonts"]);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(EXIT_SUCCESS);
    expect(result.stdout.trim().split("\n")).toEqual([
      "Licensed fonts skipped: no credentials; the build uses fallback fonts.",
    ]);
  });

  it("skips with incomplete credentials without making a request", async () => {
    await fetchFonts(directory, { env: { FONTS_S3_ACCESS_KEY_ID: EXAMPLE_ACCESS_KEY } });
    expect(request).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledOnce();
  });

  it("reuses all five nonempty files even with credentials", async () => {
    await populate();
    await fetchFonts(directory, { env: TEST_ENV });
    expect(request).not.toHaveBeenCalled();
    const result = runCli(["--out", "."], TEST_ENV);
    expect(result.status).toBe(EXIT_SUCCESS);
    expect(result.stdout.trim()).toBe("Licensed fonts already present; skipping download.");
  });

  it("fetches a complete set when a cached file is empty and writes no temporary leftovers", async () => {
    await populate();
    await writeFile(join(directory, FONT_FILES[0]), "");
    await fetchFonts(join(directory, "nested/fonts"), { env: TEST_ENV });
    await fetchFonts(directory, { env: TEST_ENV });
    expect(request).toHaveBeenCalledTimes(FONT_FILES.length * FETCH_CYCLES);
    for (const file of FONT_FILES) {
      expect(await readFile(join(directory, file), "utf8")).toBe("font fixture");
    }
    expect((await readdir(directory)).filter((file) => file.endsWith(".tmp"))).toEqual([]);
  });

  it("honors force, storage overrides and encoded object-key segments", async () => {
    await populate();
    await fetchFonts(directory, { force: true, env: {
      ...TEST_ENV, FONTS_S3_REGION: "test-region", FONTS_S3_BUCKET: "test-bucket",
      FONTS_S3_PREFIX: "assets with spaces/fonts",
    } });
    expect(request).toHaveBeenCalledTimes(FONT_FILES.length);
    const [url, options] = request.mock.calls[0];
    expect(String(url)).toBe(`http://localhost:9999/test-bucket/assets%20with%20spaces/fonts/${FONT_FILES[0]}`);
    expect((options?.headers as Record<string, string>).authorization).toContain("/test-region/s3/aws4_request");
    expect(options?.redirect).toBe("manual");
  });

  it("exits one for an HTTP failure and prints only the key and status", () => {
    const result = runCli(["--out", "."], TEST_ENV,
      `globalThis.fetch = async () => new Response(null, { status: ${HTTP_FORBIDDEN} });`);
    expect(result.status).toBe(EXIT_FAILURE);
    expect(result.stderr.trim()).toBe(`Font fetch failed for noma-dmrv-assets/fonts/${FONT_FILES[0]} (HTTP ${HTTP_FORBIDDEN}).`);
    expect(result.stderr).not.toContain(EXAMPLE_SECRET_KEY);
    expect(result.stderr).not.toContain("Signature=");
  });

  it("force reaches downloads even when every file is cached", async () => {
    await populate();
    const result = runCli(["--out", ".", "--force"], TEST_ENV,
      `globalThis.fetch = async () => new Response(null, { status: ${HTTP_FORBIDDEN} });`);
    expect(result.status).toBe(EXIT_FAILURE);
    expect(await readFile(join(directory, FONT_FILES[0]), "utf8")).toBe("cached font");
  });

  it("redacts network errors and preserves cached files", async () => {
    await populate();
    request.mockRejectedValue(new Error(`transport leaked ${EXAMPLE_SECRET_KEY} Signature=private`));
    await expect(fetchFonts(directory, { force: true, env: TEST_ENV })).rejects.toThrow(
      `Font fetch failed for noma-dmrv-assets/fonts/${FONT_FILES[0]} (HTTP unavailable).`,
    );
    expect(await readFile(join(directory, FONT_FILES[0]), "utf8")).toBe("cached font");
    expect((await readdir(directory)).sort()).toEqual([...FONT_FILES].sort());
  });

  it("never publishes a response whose body fails partway through", async () => {
    request.mockImplementation(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("partial font"));
        controller.error(new Error("interrupted body"));
      },
    })));
    await expect(fetchFonts(directory, { env: TEST_ENV })).rejects.toThrow("HTTP 200");
    expect(await readdir(directory)).toEqual([]);
  });
});
