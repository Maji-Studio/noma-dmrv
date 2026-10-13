/**
 * Object-storage smoke check — real round-trip against the configured
 * S3-compatible bucket.
 *
 * Usage:
 *   pnpm storage:smoke          # PUT → HEAD → GET → DELETE → HEAD(404)
 *
 * Exercises the live provider end-to-end the way the unit tests
 * (tests/documents-fn.test.ts) deliberately do NOT — those inject a fake
 * provider. This proves the real chain: credentials, region/endpoint,
 * path-style addressing, bucket permissions, and the presigned PUT/GET
 * round-trip all line up. Checks browser upload CORS with an OPTIONS
 * preflight from NEXT_PUBLIC_APP_URL and the actual PUT response.
 *
 * Refuses to run against local-fs — a round-trip there is meaningless. Set
 * STORAGE_PROVIDER=s3-compatible plus the STORAGE_* credentials. Locally
 * those come from .env.local; in CI they are loaded from 1Password (see
 * .github/workflows/storage-health.yml).
 *
 * Objects are written under a `_smoke/<ulid>/healthcheck/` prefix and
 * deleted at the end. The prefix is distinct from any real entityType so
 * smoke debris is trivially identifiable if a run dies before cleanup.
 */
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { config } from "dotenv";
import { smokeCorsOrigin, assertUploadCors } from "./storage-cors-core";

config({ path: ".env.local" });

const SMOKE_ENTITY_TYPE = "_smoke";
const SMOKE_DOCUMENT_TYPE = "healthcheck";
const SMOKE_CONTENT_TYPE = "text/plain";
const SMOKE_MAX_BYTES = 1024;
const PRESIGN_TTL_SECONDS = 120;

export async function runStorageSmoke(): Promise<void> {
  // Defer imports until env is loaded so env.ts validation sees the values.
  const { getStorageProvider, buildStorageKey } = await import(
    "../src/lib/storage"
  );
  const { ulid } = await import("ulid");

  const provider = getStorageProvider();
  if (provider.name === "local-fs") {
    console.error(
      "Refusing to smoke-test local-fs — a round-trip there proves nothing.\n" +
        "  Set STORAGE_PROVIDER=s3-compatible and the STORAGE_* credentials.",
    );
    process.exit(2);
  }

  const origin = smokeCorsOrigin(process.env.NEXT_PUBLIC_APP_URL ?? "", Boolean(process.env.CI));
  if (origin === null) {
    console.log("SKIP CORS     → local HTTP loopback origin; storage round-trip only");
  }
  console.log(`Storage provider: ${provider.name} (bucket=${provider.bucket})`);

  const key = buildStorageKey({
    entityType: SMOKE_ENTITY_TYPE,
    entityId: ulid().toLowerCase(),
    documentType: SMOKE_DOCUMENT_TYPE,
    fileName: "probe.txt",
  });
  // Random token embedded in the body so the GET round-trip proves we read
  // back exactly what we wrote, not a stale or mismatched object.
  const token = randomUUID();
  const body = `noma-dmrv storage smoke ${token}\n`;
  const expectedBytes = Buffer.byteLength(body);

  console.log(`Probe key: ${key}`);

  let uploaded = false;
  const corsFailures: string[] = [];
  try {
    // 1. Mint presigned PUT and upload.
    const upload = await provider.createUploadUrl({
      key,
      contentType: SMOKE_CONTENT_TYPE,
      maxBytes: SMOKE_MAX_BYTES,
      expiresInSeconds: PRESIGN_TTL_SECONDS,
    });
    console.log(`PUT target: ${safeUrlSummary(upload.url)}`);
    if (origin !== null) {
      try {
        await assertUploadCors(upload.url, origin);
        console.log("OK  CORS     → app-origin PUT preflight accepted");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Storage CORS preflight failed";
        corsFailures.push(message);
        console.error(message);
      }
    }
    const putRes = await fetchOrFail("PUT", upload.url, {
      method: upload.method,
      headers: { ...upload.headers, ...(origin === null ? {} : { Origin: origin }) },
      body,
    });
    if (!putRes.ok) {
      const detail = await safeReadBody(putRes);
      fail(`PUT failed: ${putRes.status} ${putRes.statusText}${detail}`);
    }
    uploaded = true;
    const allowedOrigin = putRes.headers.get("access-control-allow-origin");
    if (origin !== null && allowedOrigin !== origin && allowedOrigin !== "*") {
      const message = "PUT response does not allow the configured app origin through CORS.";
      corsFailures.push(message);
      console.error(message);
    }
    console.log(`OK  PUT      → ${putRes.status} (${expectedBytes} bytes)`);

    // 2. HEAD — the same gate confirmUpload() relies on.
    const head = await provider.headObject(key);
    if (!head) fail("HEAD returned null immediately after a successful PUT.");
    if (head!.size !== expectedBytes) {
      fail(`HEAD size mismatch: expected ${expectedBytes}, got ${head!.size}.`);
    }
    if (!head!.contentType.startsWith(SMOKE_CONTENT_TYPE)) {
      fail(
        `HEAD content-type mismatch: expected ${SMOKE_CONTENT_TYPE}, got ${head!.contentType}.`,
      );
    }
    console.log(
      `OK  HEAD     → size=${head!.size} type=${head!.contentType} etag=${head!.etag}`,
    );

    // 3. Signed GET — verify byte-for-byte round-trip.
    const downloadUrl = await provider.createDownloadUrl({
      key,
      expiresInSeconds: PRESIGN_TTL_SECONDS,
    });
    console.log(`GET target: ${safeUrlSummary(downloadUrl)}`);
    const getRes = await fetchOrFail("GET", downloadUrl);
    if (!getRes.ok) {
      const detail = await safeReadBody(getRes);
      fail(`GET failed: ${getRes.status} ${getRes.statusText}${detail}`);
    }
    const roundTripped = await getRes.text();
    if (roundTripped !== body) {
      fail("GET body does not match what was uploaded.");
    }
    console.log(`OK  GET      → body round-trip matches`);

    // 4. Delete and confirm it's gone.
    await provider.deleteObject(key);
    uploaded = false;
    const headAfter = await provider.headObject(key);
    if (headAfter !== null) {
      fail("HEAD after DELETE returned an object — deletion did not take.");
    }
    console.log(`OK  DELETE   → object gone (HEAD 404)`);

    console.log("\nOK — storage round-trip passed.");
    if (corsFailures.length > 0) {
      fail(`Storage CORS checks failed: ${corsFailures.join("; ")}`);
    }
  } catch (err) {
    // Best-effort cleanup so a mid-run failure doesn't leave debris.
    if (uploaded) {
      try {
        await provider.deleteObject(key);
        console.error(`(cleaned up probe object ${key})`);
      } catch (cleanupErr) {
        console.error(
          `(failed to clean up probe object ${key}: ${String(cleanupErr)})`,
        );
      }
    }
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

function fail(message: string): never {
  throw new Error(message);
}

async function safeReadBody(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text ? ` — ${text.slice(0, 500)}` : "";
  } catch {
    return "";
  }
}

async function fetchOrFail(
  label: string,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    throw new Error(
      `${label} network request failed for ${safeUrlSummary(url)}: ${formatError(err)}`,
    );
  }
}

function safeUrlSummary(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return "<invalid-url>";
  }
}

function formatError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const details = [err.message];
  const cause = (err as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    details.push(`cause=${cause.message}`);
    const code = (cause as { code?: unknown }).code;
    if (code) details.push(`code=${String(code)}`);
  } else if (cause) {
    details.push(`cause=${String(cause)}`);
  }
  return details.join(" ");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runStorageSmoke().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
