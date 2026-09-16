import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalFsProvider } from "@/lib/storage/local-fs";
import { S3CompatibleProvider } from "@/lib/storage/s3-compatible";
import {
  STORAGE_GET_OBJECT_TIMEOUT_MS,
} from "@/lib/storage/get-object";
import { StorageError } from "@/lib/storage/types";

const STORAGE_KEY = "org/org-1/sample/sample-1/report/file.pdf";

// Only the HTTP-backed provider reads through fetch. local-fs reads its own
// files from disk so server-side readers never depend on the app's HTTP route.
const PROVIDERS = [
  {
    name: "s3-compatible",
    create: () =>
      new S3CompatibleProvider({
        bucket: "maji",
        region: "fra1",
        endpoint: "https://fra1.digitaloceanspaces.com",
        accessKeyId: "test-access-key",
        secretAccessKey: "test-secret-key",
      }),
  },
] as const;

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe.each(PROVIDERS)("$name getObject", ({ create }) => {
  it("returns bytes and the response content type without following redirects", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("stored bytes", {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      }),
    );

    const object = await create().getObject({ key: STORAGE_KEY });

    expect(object.bytes.toString("utf8")).toBe("stored bytes");
    expect(object.contentType).toBe("application/pdf");
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ redirect: "error" }),
    );
  });

  it("uses the binary content type fallback when the response omits it", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    );

    const object = await create().getObject({ key: STORAGE_KEY });

    expect(object.contentType).toBe("application/octet-stream");
  });

  it("rejects non-success responses and clears the deadline", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("unavailable", { status: 503 }),
    );

    await expect(create().getObject({ key: STORAGE_KEY })).rejects.toMatchObject({
      name: "StorageError",
      code: "get_object_failed",
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts stalled reads at the named deadline and clears the timer", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init): Promise<Response> =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            },
            { once: true },
          );
        }),
    );

    const read = create().getObject({ key: STORAGE_KEY });
    const rejection = expect(read).rejects.toEqual(
      new StorageError("Stored object read timed out", "get_object_timeout"),
    );
    await vi.advanceTimersByTimeAsync(STORAGE_GET_OBJECT_TIMEOUT_MS);
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("local-fs getObject", () => {
  let root: string;
  const create = () =>
    new LocalFsProvider({
      root,
      appUrl: "http://localhost:3100",
      signingSecret: "test-signing-secret-at-least-32-chars",
    });

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("reads bytes and the stored content type from disk without fetch", async () => {
    root = await mkdtemp(path.join(tmpdir(), "storage-get-object-"));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const provider = create();
    await provider.putObject(STORAGE_KEY, Buffer.from("stored bytes"), "application/pdf");

    const object = await provider.getObject({ key: STORAGE_KEY });

    expect(object.bytes.toString("utf8")).toBe("stored bytes");
    expect(object.contentType).toBe("application/pdf");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports a missing object as a storage error", async () => {
    root = await mkdtemp(path.join(tmpdir(), "storage-get-object-"));

    await expect(create().getObject({ key: STORAGE_KEY })).rejects.toMatchObject({
      name: "StorageError",
      code: "get_object_failed",
    });
  });

  it("rejects unsafe keys", async () => {
    root = await mkdtemp(path.join(tmpdir(), "storage-get-object-"));

    await expect(create().getObject({ key: "../escape" })).rejects.toMatchObject({
      name: "StorageError",
    });
  });
});
