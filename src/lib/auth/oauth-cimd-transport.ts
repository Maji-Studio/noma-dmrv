import { validateClientIdUrl } from "@better-auth/cimd";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import type { fetchClientMetadataResource as nodeTransport } from "@better-auth/cimd/node";

const BODY_FORBIDDEN_STATUSES = new Set([204, 205, 304]);
const FALLBACK_STATUS = 500;

// CIMD's public URL validator uses the same public-routable host classifier
// as its Node transport, without importing an undeclared transitive dependency.
function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (!family) return false;
  const host = family === 6 ? `[${address}]` : address;
  return validateClientIdUrl(`https://${host}/`) === null;
}

/** Preserve the Node CIMD transport's DNS pinning, with cancellation across DNS too. */
export const fetchClientMetadataResource: typeof nodeTransport = async (input, init) => {
  const webRequest = new Request(input, init);
  const url = new URL(webRequest.url);
  const signal = init?.signal ?? (input instanceof Request ? input.signal : webRequest.signal);
  signal.throwIfAborted();
  if (url.protocol !== "https:") throw new TypeError("CIMD Node transport requires an HTTPS URL");
  if (webRequest.method !== "GET" && webRequest.method !== "HEAD") throw new TypeError("CIMD Node transport supports only GET and HEAD");

  let onAbort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  const fetch = async () => {
    const addresses = await lookup(url.hostname, { all: true, verbatim: true });
    // DNS itself cannot be cancelled. A late answer must never open a socket.
    signal.throwIfAborted();
    if (!addresses.length || addresses.some(result => !isPublicAddress(result.address))) {
      throw new TypeError("metadata hostname must resolve only to public-routable addresses");
    }
    const pinned = addresses[0];
    return new Promise<Response>((resolve, reject) => {
      const outgoing = request(url, {
        agent: false,
        headers: { ...Object.fromEntries(webRequest.headers.entries()), host: url.host },
        method: webRequest.method,
        servername: isIP(url.hostname.replace(/^\[|\]$/g, "")) === 0 ? url.hostname : undefined,
        signal,
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, [pinned]);
          else callback(null, pinned.address, pinned.family);
        },
      }, response => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) for (const item of value) headers.append(name, item);
          else if (value !== undefined) headers.append(name, value);
        }
        const status = response.statusCode ?? FALLBACK_STATUS;
        const body = webRequest.method === "HEAD" || BODY_FORBIDDEN_STATUSES.has(status)
          ? null : Readable.toWeb(response) as ReadableStream<Uint8Array>;
        resolve(new Response(body, { headers, status, statusText: response.statusMessage }));
      });
      outgoing.once("error", reject);
      outgoing.end();
    });
  };
  try {
    return await Promise.race([fetch(), aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
};
