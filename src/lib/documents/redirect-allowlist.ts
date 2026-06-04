/**
 * Open-redirect guard for the `/api/documents/[id]` route.
 *
 * When a document row carries a legacy `fileUrl` (rather than an internal
 * `storageKey`), the route 302-redirects the browser to it. The target is not
 * attacker-controlled via the request — it comes from a document row keyed by a
 * random UUID, writable only by authenticated users — so the residual risk is a
 * malicious authed user storing a phishing URL to borrow this origin's domain
 * trust. This guard closes that: the redirect host must be our own origin, the
 * configured object-storage endpoint, or one of the **narrow** storage host
 * families Isometric presigns against (where synced GHG-statement report URLs
 * live). Anything else is refused (fail-closed) and logged by the caller.
 *
 * Sibling to `@/lib/isometric/utils/signed-upload`'s upload-host allowlist; the
 * two guard opposite directions (we PUT to upload hosts; we redirect a browser
 * to these). They keep their own host *sets* and override env vars but share the
 * matching algorithm via `@/lib/net/host-allowlist`, so the two SSRF policies
 * can't silently drift.
 *
 * To pin redirects to an exact known bucket/host (tightest), set
 * `ISOMETRIC_STORAGE_REDIRECT_HOSTS` — it replaces the default families below.
 */
import { env } from "@/config/env";
import {
  hostAllowed,
  hostOf,
  resolveHostAllowlist,
} from "@/lib/net/host-allowlist";

// Narrow storage families (mirrors signed-upload's DEFAULT_UPLOAD_HOST_SUFFIXES):
// `.s3.amazonaws.com` (+ regional/dualstack S3 patterns from the shared matcher)
// and `.storage.googleapis.com`, NOT the broad `.amazonaws.com` / `.googleapis.com`
// which admit any tenant bucket or unrelated provider API host.
const DEFAULT_REDIRECT_HOST_SUFFIXES = [
  ".s3.amazonaws.com",
  ".isometric.com",
  ".digitaloceanspaces.com",
  ".storage.googleapis.com",
] as const;

/**
 * Exact-match hosts: our own origin (covers local-fs storage + app links) and
 * the configured S3-compatible storage endpoint, if any.
 */
function exactAllowedHosts(): string[] {
  return [hostOf(env.NEXT_PUBLIC_APP_URL), hostOf(env.STORAGE_ENDPOINT)].filter(
    (host): host is string => host !== null,
  );
}

export function isAllowedRedirectHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (exactAllowedHosts().includes(host)) return true;
  return hostAllowed(
    host,
    resolveHostAllowlist(
      env.ISOMETRIC_STORAGE_REDIRECT_HOSTS,
      DEFAULT_REDIRECT_HOST_SUFFIXES,
    ),
  );
}
