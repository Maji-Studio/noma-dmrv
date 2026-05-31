/**
 * Phase 3.5 — Source blob transfer + request-body helpers.
 *
 * Extracted from `sources.ts` to keep that file under the 1000-line limit and
 * to isolate the SSRF-sensitive transfer surface. Pure server-side helpers:
 * build the CreateDocumentSource request body, download the noma-managed
 * bytes, and PUT them to Isometric's presigned URL behind a host allowlist.
 * No exported server actions live here.
 */
import { env } from "@/config/env";
import type { DocumentRow } from "@/data-access/certification";
import { SafeError } from "@/lib/errors";
import type { CreateDocumentSourceRequest } from "@/lib/isometric";
import { getStorageProvider } from "@/lib/storage";

// Cap on how long a single storage GET / registry PUT may take before we abort
// and surface a timeout. Without it a hung connection would pin the server
// action indefinitely — Fluid Compute reuses instances, so a stuck fetch leaks
// across requests rather than dying with its process.
const TRANSFER_TIMEOUT_MS = 30_000;

// fetch() with an AbortController-backed deadline. The timer is cleared in
// `finally` (both success and error) so it never leaks; an aborted request
// surfaces as a SafeError rather than a raw AbortError. Covers the connection +
// header phase; streaming the body (e.g. `response.blob()`) happens after the
// timer is cleared, matching the "guard the call, not the read" contract.
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRANSFER_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new SafeError(
        `Storage transfer timed out after ${TRANSFER_TIMEOUT_MS / 1000}s.`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function buildSourceRequestBody(args: {
  externalProjectId: string;
  document: DocumentRow;
  supplierRefId: string;
  isPublic: boolean;
}): CreateDocumentSourceRequest {
  const { externalProjectId, document, supplierRefId, isPublic } = args;
  // Isometric requires non-null content_length / content_type / file_name. The
  // pre-flight check enforces this; the `!` here is post-validation.
  const contentLength = document.fileSizeBytes!;
  const contentType = document.mimeType!;
  const publishedAt = (document.capturedAt ?? document.createdAt)
    .toISOString()
    .slice(0, 10);
  return {
    __typename: "CreateDocumentSourceRequest",
    content_length: contentLength,
    content_type: contentType,
    display_name: document.fileName,
    file_name: document.fileName,
    is_public: isPublic,
    project_id: externalProjectId,
    published_at: publishedAt,
    supplier_reference_id: supplierRefId,
  };
}

export async function downloadDocumentBlob(
  document: DocumentRow,
): Promise<{ blob: Blob; contentType: string }> {
  if (!document.storageKey) {
    throw new SafeError(
      "This document has no managed storage (legacy URL-only). Re-upload through noma before mirroring to Isometric.",
    );
  }
  const provider = getStorageProvider();
  const url = await provider.createDownloadUrl({ key: document.storageKey });
  const response = await fetchWithTimeout(url, {});
  if (!response.ok) {
    throw new SafeError(
      `Failed to read document from storage (${response.status}).`,
    );
  }
  const contentType = document.mimeType ?? "application/octet-stream";
  const blob = await response.blob();
  return { blob, contentType };
}

// Hosts the mirror flow is allowed to PUT bytes to. Isometric returns a
// presigned URL pointing at object storage; if a malicious / misconfigured
// API rerouted that URL at an internal address, fetch() would happily ship
// the document bytes there. Allowlist + protocol check + redirect denial
// constrain the SSRF surface to documented storage hosts.
const DEFAULT_UPLOAD_HOST_SUFFIXES = [
  ".s3.amazonaws.com",
  ".amazonaws.com",
  ".isometric.com",
  ".digitaloceanspaces.com",
] as const;

function uploadHostSuffixes(): string[] {
  const raw = env.ISOMETRIC_UPLOAD_HOST_ALLOWLIST;
  if (!raw) return [...DEFAULT_UPLOAD_HOST_SUFFIXES];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => (entry.startsWith(".") ? entry : `.${entry}`));
}

function assertUploadHostAllowed(uploadUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(uploadUrl);
  } catch {
    throw new SafeError("Isometric returned a malformed upload URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new SafeError(
      `Refusing PUT to non-HTTPS upload URL (protocol=${parsed.protocol}).`,
    );
  }
  const hostname = `.${parsed.hostname.toLowerCase()}`;
  const allowed = uploadHostSuffixes();
  if (!allowed.some((suffix) => hostname.endsWith(suffix.toLowerCase()))) {
    throw new SafeError(
      `Refusing PUT to upload URL with host "${parsed.hostname}" — not in ISOMETRIC_UPLOAD_HOST_ALLOWLIST.`,
    );
  }
}

export async function putBlobToSignedUrl(
  uploadUrl: string,
  blob: Blob,
  contentType: string,
): Promise<void> {
  assertUploadHostAllowed(uploadUrl);
  const response = await fetchWithTimeout(uploadUrl, {
    method: "PUT",
    body: blob,
    redirect: "error",
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(blob.size),
    },
  });
  if (!response.ok) {
    // Do NOT echo the response body — third-party storage gateways can
    // include request fragments in error pages and this message lands in
    // certifier_sync_events. Status code alone is enough to diagnose;
    // detailed body inspection belongs in non-persistent debug logs only.
    throw new SafeError(
      `Isometric PUT upload failed (status ${response.status}).`,
    );
  }
}
