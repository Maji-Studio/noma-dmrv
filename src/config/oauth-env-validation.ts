import { isIP } from "node:net";
import { z } from "zod";

const DNS_LABEL_MAX_LENGTH = 63;
const NON_PUBLIC_SUFFIXES = ["localhost", "local", "internal", "test", "invalid", "example", "onion", "home.arpa"];

function isExactPublicClientId(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname;
    const authority = value.slice("https://".length).split("/")[0];
    return value.startsWith("https://") && url.protocol === "https:" && url.pathname !== "/" &&
      !url.username && !url.password && !url.search && !url.hash && !/[?#]/.test(value) && !authority.includes(":") &&
      !isIP(host) && !host.endsWith(".") && host.includes(".") &&
      host.split(".").every(label => label.length <= DNS_LABEL_MAX_LENGTH && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)) &&
      !NON_PUBLIC_SUFFIXES.some(suffix => host === suffix || host.endsWith(`.${suffix}`));
  } catch { return false; }
}

export const oauthClientIdsSchema = z.string().default("").transform(value => value.trim() === "" ? [] : value.split(",").map(id => id.trim()))
  .refine(ids => ids.every(isExactPublicClientId), "OAuth client identities must be exact HTTPS URLs with a path and a public DNS host, without credentials, port, query or fragment.");

export function isOAuthProductionOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && value === url.origin;
  } catch { return false; }
}
