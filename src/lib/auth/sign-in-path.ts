const DEFAULT_SIGN_IN_PATH = "/";

/** Resolve the decoded `from` query parameter to a same-origin navigation path. */
export function getSafeSignInPath(from: string | null, appOrigin: string): string {
  if (
    !from ||
    !from.startsWith("/") ||
    from.startsWith("//") ||
    from.includes("://") ||
    from.includes("\\") ||
    Array.from(from).some(char => char < " " || char === "\u007f") ||
    /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(from)
  ) return DEFAULT_SIGN_IN_PATH;

  try {
    const url = new URL(from, appOrigin);
    // Dot-segment normalization can produce a protocol-relative pathname.
    if (url.origin !== new URL(appOrigin).origin || url.pathname.startsWith("//")) {
      return DEFAULT_SIGN_IN_PATH;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return DEFAULT_SIGN_IN_PATH;
  }
}
