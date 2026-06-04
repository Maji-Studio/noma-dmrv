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
 * policies can't silently drift (a maintainability trap flagged in review).
 *
 * An entry's leading dot decides how it matches: a leading-dot entry
 * (`.amazonaws.com`) is a *suffix* — and the dot-normalized compare means
 * `evilamazonaws.com` can't slip past it — while a dotless entry
 * (`bucket.s3.eu-west-1.amazonaws.com`) is an *exact* host pin that does NOT
 * admit subdomains.
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
  /** Exact host pins (no leading dot, lower-cased), e.g. `bucket.s3.amazonaws.com`. Subdomains are NOT admitted. */
  exactHosts: string[];
  /** Leading-dot host suffixes (lower-cased), e.g. `.s3.amazonaws.com`. */
  suffixes: string[];
  /** Whether the built-in regional/dualstack S3 patterns also apply (defaults only). */
  includeDefaultS3Patterns: boolean;
}

/**
 * Partition comma-/list-separated entries: a leading-dot entry is a suffix; any
 * other entry is an exact host pin. Both are trimmed, lower-cased, and emptied
 * out so comparisons in `hostAllowed` are reliable.
 */
function partitionEntries(entries: Iterable<string>): {
  exactHosts: string[];
  suffixes: string[];
} {
  const exactHosts: string[] = [];
  const suffixes: string[] = [];
  for (const raw of entries) {
    const entry = raw.trim().toLowerCase();
    if (entry.length === 0) continue;
    if (entry.startsWith(".")) {
      // A suffix must be a real dotted label sequence — reject malformed forms
      // (`.`, `..example.com`, `example.`, doubled dots) rather than store an
      // entry that can never match a legitimate host.
      if (entry.length > 1 && !entry.endsWith(".") && !entry.includes("..")) {
        suffixes.push(entry);
      }
    } else exactHosts.push(entry);
  }
  return { exactHosts, suffixes };
}

/**
 * Resolve an allowlist from an optional comma-separated env override. When the
 * env value is set it **replaces** the defaults (explicit, tightest — e.g. a
 * single known bucket host pinned exactly); when unset the caller's `defaults`
 * apply along with the built-in S3 regional/dualstack patterns.
 */
export function resolveHostAllowlist(
  envRaw: string | undefined,
  defaults: readonly string[],
): HostAllowlist {
  // A whitespace-only value (e.g. `"  "`) is treated the same as unset —
  // otherwise it would partition to an empty allowlist with the defaults
  // dropped, silently blocking every host.
  if (!envRaw || envRaw.trim().length === 0) {
    return { ...partitionEntries(defaults), includeDefaultS3Patterns: true };
  }
  return {
    ...partitionEntries(envRaw.split(",")),
    includeDefaultS3Patterns: false,
  };
}

/** True if `host` is permitted by `allowlist` (exact pin, suffix match, or default S3 pattern). */
export function hostAllowed(host: string, allowlist: HostAllowlist): boolean {
  const h = host.toLowerCase();
  if (allowlist.exactHosts.includes(h)) return true;
  const dotted = `.${h}`;
  if (allowlist.suffixes.some((suffix) => dotted.endsWith(suffix))) {
    return true;
  }
  return allowlist.includeDefaultS3Patterns && isDefaultS3Host(host);
}

/** Lowercased hostname of a URL, or `null` if absent / unparseable. */
export function hostOf(url: string | undefined): string | null {
  if (!url || !URL.canParse(url)) return null;
  return new URL(url).hostname.toLowerCase();
}
