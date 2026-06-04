/**
 * Shared host-allowlist primitives for the app's two SSRF guards.
 *
 * Two guards constrain which hosts we talk to:
 *   - the upload guard (`@/lib/isometric/utils/signed-upload`) — we PUT
 *     presigned bytes to whatever URL Isometric returns, and
 *   - the document redirect guard (`@/lib/documents/redirect-allowlist`) — we
 *     302 a browser to a legacy `fileUrl`.
 *
 * They keep their own *host sets* but share this matching algorithm so the two
 * policies can't silently drift (a maintainability trap flagged in review). All
 * suffix matching uses a leading-dot normalization so `evilamazonaws.com` can't
 * slip past `.amazonaws.com`.
 */

// Isometric presigns object-storage URLs against regional / dualstack S3 hosts
// (e.g. `bucket.s3.eu-west-1.amazonaws.com`). These patterns admit those without
// opening the broad `.amazonaws.com` (which also covers sts / ec2 / console /
// every other AWS service host).
export const S3_REGIONAL_HOST_PATTERN =
  /(^|\.)s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/;
export const S3_DUALSTACK_HOST_PATTERN =
  /(^|\.)s3\.dualstack\.[a-z0-9-]+\.amazonaws\.com$/;

export function isDefaultS3Host(host: string): boolean {
  const h = host.toLowerCase();
  return S3_REGIONAL_HOST_PATTERN.test(h) || S3_DUALSTACK_HOST_PATTERN.test(h);
}

export interface HostAllowlist {
  /** Leading-dot host suffixes, e.g. `.s3.amazonaws.com`. */
  suffixes: string[];
  /** Whether the built-in regional/dualstack S3 patterns also apply (defaults only). */
  includeDefaultS3Patterns: boolean;
}

/**
 * Resolve an allowlist from an optional comma-separated env override. When the
 * env value is set it **replaces** the defaults (explicit, tightest — e.g. a
 * single known bucket host); when unset the caller's `defaults` apply along with
 * the built-in S3 regional/dualstack patterns.
 */
export function resolveHostAllowlist(
  envRaw: string | undefined,
  defaults: readonly string[],
): HostAllowlist {
  if (!envRaw) {
    return { suffixes: [...defaults], includeDefaultS3Patterns: true };
  }
  return {
    suffixes: envRaw
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .map((entry) => (entry.startsWith(".") ? entry : `.${entry}`)),
    includeDefaultS3Patterns: false,
  };
}

/** True if `host` is permitted by `allowlist` (suffix match or default S3 pattern). */
export function hostAllowed(host: string, allowlist: HostAllowlist): boolean {
  const dotted = `.${host.toLowerCase()}`;
  if (allowlist.suffixes.some((suffix) => dotted.endsWith(suffix.toLowerCase()))) {
    return true;
  }
  return allowlist.includeDefaultS3Patterns && isDefaultS3Host(host);
}

/** Lowercased hostname of a URL, or `null` if absent / unparseable. */
export function hostOf(url: string | undefined): string | null {
  if (!url || !URL.canParse(url)) return null;
  return new URL(url).hostname.toLowerCase();
}
