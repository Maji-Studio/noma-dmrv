/**
 * Open-redirect guard for the `/api/documents/[id]` route.
 *
 * When a document row carries a legacy `fileUrl` (rather than an internal
 * `storageKey`), the route 302-redirects the browser to it. The target is not
 * attacker-controlled via the request — it comes from a document row keyed by a
 * random UUID, writable only by authenticated users — so the residual risk is a
 * malicious authed user storing a phishing URL to borrow this origin's domain
 * trust. This guard closes that: the redirect host must be our own origin, the
 * configured object-storage endpoint, or one of the registry / cloud-storage
 * host families Isometric presigns against (where synced GHG-statement report
 * URLs live). Anything else is refused (fail-closed) and logged by the caller.
 *
 * Sibling to `@/lib/isometric/utils/signed-upload`'s upload-host allowlist; the
 * two guard opposite directions (we PUT to upload hosts; we redirect a browser
 * to these), so they stay separate modules with their own host sets.
 */
import { env } from "@/config/env";

// Registry + cloud-storage families. Synced GHG-statement report URLs and any
// Isometric-presigned object live under these; matched as host suffixes after a
// leading-dot normalization so `evilamazonaws.com` can't slip past
// `.amazonaws.com`.
const CLOUD_HOST_SUFFIXES = [
  ".isometric.com",
  ".amazonaws.com",
  ".googleapis.com",
  ".digitaloceanspaces.com",
] as const;

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Exact-match hosts: our own origin (covers local-fs storage + app links) and
 * the configured S3-compatible storage endpoint, if any.
 */
function exactAllowedHosts(): string[] {
  return [hostOf(env.NEXT_PUBLIC_APP_URL), hostOf(env.STORAGE_ENDPOINT)].filter(
    (host): host is string => host !== null
  );
}

export function isAllowedRedirectHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (exactAllowedHosts().includes(host)) return true;
  const dotted = `.${host}`;
  return CLOUD_HOST_SUFFIXES.some((suffix) => dotted.endsWith(suffix));
}
