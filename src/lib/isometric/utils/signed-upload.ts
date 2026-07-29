/**
 * SSRF-safe transfer helpers for Isometric presigned upload URLs.
 *
 * Both the Sources mirror (PUT document bytes) and the Phase 5 telemetry
 * pipeline (PUT Parquet bytes) ship local bytes to whatever URL Isometric
 * returns from a `/file-uploads` or source-upload presign. If a malicious or
 * misconfigured API rerouted that URL at an internal address, a naive fetch()
 * would happily exfiltrate the bytes. The allowlist + protocol check + redirect
 * denial + timeout constrain that surface; this module is the single home for
 * the guard so every signed-URL PUT shares one policy.
 */
import { env } from "@/config/env";
import { SafeError } from "@/lib/errors";
import { hostAllowed, resolveHostAllowlist } from "@/lib/net/host-allowlist";

// Cap on how long a single registry PUT may take before we abort and surface a
// timeout. Without it a hung connection would pin the server action
// indefinitely — Fluid Compute reuses instances, so a stuck fetch leaks across
// requests rather than dying with its process.
export const UPLOAD_TRANSFER_TIMEOUT_MS = 30_000;

// Hosts the upload flows are allowed to PUT bytes to. Isometric presigns
// against object storage; the sandbox returns S3-style URLs for source uploads
// (2026-05-29) and Google Cloud Storage URLs (`X-Goog-*`) for the telemetry
// file-upload step (ADR 0006). Scoped to the specific storage host families —
// `.storage.googleapis.com` (the GCS object endpoint), not the broad
// `.googleapis.com` (which would also allow every other Google API host).
// Host set this guard PUTs bytes to. The matching algorithm (suffix +
// regional/dualstack S3 patterns + env override) is shared with the document
// redirect guard via `@/lib/net/host-allowlist`; only the host SET and the
// override env var differ between the two.
const DEFAULT_UPLOAD_HOST_SUFFIXES = [
  ".s3.amazonaws.com",
  ".isometric.com",
  ".digitaloceanspaces.com",
  ".storage.googleapis.com",
] as const;

export function assertUploadHostAllowed(uploadUrl: string): void {
  if (!URL.canParse(uploadUrl)) {
    throw new SafeError("Isometric returned a malformed upload URL.");
  }
  const parsed = new URL(uploadUrl);
  if (parsed.protocol !== "https:") {
    throw new SafeError(
      "The registry returned an unsafe upload address. Retry the submission or contact support.",
    );
  }
  const allowlist = resolveHostAllowlist(
    env.ISOMETRIC_UPLOAD_HOST_ALLOWLIST,
    DEFAULT_UPLOAD_HOST_SUFFIXES,
  );
  if (!hostAllowed(parsed.hostname, allowlist)) {
    throw new SafeError(
      `The registry returned an unsupported upload destination, "${parsed.hostname}". Retry the submission or contact support.`,
    );
  }
}

// fetch() with an AbortController-backed deadline. The timer is cleared in
// `finally` (both success and error) so it never leaks; an aborted request
// surfaces as a SafeError rather than a raw AbortError.
export async function fetchSignedUploadWithTimeout(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    UPLOAD_TRANSFER_TIMEOUT_MS,
  );
  try {
    // `redirect: "error"` is applied last so it can't be overridden by a
    // caller's `init` — every signed-URL transfer (PUT bytes AND the storage
    // GET in downloadDocumentBlob) must refuse a redirect, since a rerouted
    // hop is the SSRF vector this module exists to close.
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      redirect: "error",
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new SafeError(
        "The file transfer timed out. Check your connection and try again.",
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
