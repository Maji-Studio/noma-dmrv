/**
 * The one same-origin guard for every OAuth continuation the browser follows:
 * after sign-in, after the organization picker and after consent.
 */

function isSignedCallback(url: URL, callback: URL): boolean {
  if (url.origin !== callback.origin || url.pathname !== callback.pathname || url.hash !== "") return false;
  return [...callback.searchParams].every(([name, value]) => url.searchParams.getAll(name).includes(value));
}

/** Returns the absolute URL to follow, or null when the continuation is not safe. */
export function safeOAuthContinuation(value: string, query: Pick<URLSearchParams, "get" | "getAll">): string | null {
  try {
    const url = new URL(value, window.location.origin);
    if (value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") &&
      url.origin === window.location.origin) return url.href;
    // Remembered consent and the final authorization response go straight to
    // the client's callback with the response parameters (code, state, iss)
    // appended, so match the signed redirect_uri's origin and path and keep its
    // own query parameters.
    const signedCallback = query.get("redirect_uri");
    if (query.get("sig") && query.getAll("ba_param").includes("redirect_uri") && signedCallback &&
      ["https:", "http:"].includes(url.protocol) && isSignedCallback(url, new URL(signedCallback))) return url.href;
  } catch { /* Malformed continuations must restart authorization. */ }
  return null;
}

/** Navigates fully to a safe continuation. Returns false, without navigating, when it is not safe. */
export function followOAuthContinuation(value: string, query: Pick<URLSearchParams, "get" | "getAll">): boolean {
  const continuation = safeOAuthContinuation(value, query);
  if (!continuation) return false;
  window.location.assign(continuation);
  return true;
}

/** The signed query of the current OAuth page, as the provider expects it back. */
export function currentOAuthQuery(): string {
  return window.location.search.replace(/^\?/, "");
}
