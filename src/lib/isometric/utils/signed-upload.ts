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
const DEFAULT_UPLOAD_HOST_SUFFIXES = [
  ".s3.amazonaws.com",
  ".isometric.com",
  ".digitaloceanspaces.com",
  ".storage.googleapis.com",
] as const;

const S3_REGIONAL_HOST_PATTERN =
  /(^|\.)s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/;
const S3_DUALSTACK_HOST_PATTERN =
  /(^|\.)s3\.dualstack\.[a-z0-9-]+\.amazonaws\.com$/;

function uploadHostAllowlist(): {
  suffixes: string[];
  includeDefaultS3Patterns: boolean;
} {
  const raw = env.ISOMETRIC_UPLOAD_HOST_ALLOWLIST;
  if (!raw) {
    return {
      suffixes: [...DEFAULT_UPLOAD_HOST_SUFFIXES],
      includeDefaultS3Patterns: true,
    };
  }
  return {
    suffixes: raw
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .map((entry) => (entry.startsWith(".") ? entry : `.${entry}`)),
    includeDefaultS3Patterns: false,
  };
}

export function assertUploadHostAllowed(uploadUrl: string): void {
  if (!URL.canParse(uploadUrl)) {
    throw new SafeError("Isometric returned a malformed upload URL.");
  }
  const parsed = new URL(uploadUrl);
  if (parsed.protocol !== "https:") {
    throw new SafeError(
      `Refusing PUT to non-HTTPS upload URL (protocol=${parsed.protocol}).`,
    );
  }
  const hostname = `.${parsed.hostname.toLowerCase()}`;
  const allowed = uploadHostAllowlist();
  const defaultAllowed =
    allowed.suffixes.some((suffix) =>
      hostname.endsWith(suffix.toLowerCase()),
    ) ||
    (allowed.includeDefaultS3Patterns &&
      (S3_REGIONAL_HOST_PATTERN.test(parsed.hostname.toLowerCase()) ||
        S3_DUALSTACK_HOST_PATTERN.test(parsed.hostname.toLowerCase())));
  if (!defaultAllowed) {
    throw new SafeError(
      `Refusing PUT to upload URL with host "${parsed.hostname}" — not in ISOMETRIC_UPLOAD_HOST_ALLOWLIST.`,
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
        `Storage transfer timed out after ${UPLOAD_TRANSFER_TIMEOUT_MS / 1000}s.`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
