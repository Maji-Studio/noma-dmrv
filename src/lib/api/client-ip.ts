import { createHash } from "node:crypto";
import { BlockList, isIP } from "node:net";
import { API_CONNECTOR_EGRESS_CIDRS } from "@/config/api-rate-limits";

const IPV4_OCTET_BITS = 8;
const IPV4_OCTET_MASK = 255;

function cidrBlockList(cidr: string): BlockList {
  const [network, prefix, extra] = cidr.split("/");
  const family = isIP(network);
  if (extra !== undefined || !family || !/^\d+$/.test(prefix ?? "")) throw new Error("Invalid connector CIDR.");
  const list = new BlockList();
  list.addSubnet(network, Number(prefix), family === 4 ? "ipv4" : "ipv6");
  return list;
}

// Validate every configured subnet at startup, before accepting requests.
const configuredCidrs = new Map<string, BlockList>(API_CONNECTOR_EGRESS_CIDRS.map(cidr => [cidr, cidrBlockList(cidr)]));

function normalizeMappedIpv4(ip: string): string {
  if (isIP(ip) !== 6) return ip;
  const mapped = new URL(`http://[${ip}]`).hostname.match(/^\[::ffff:([a-f\d]+):([a-f\d]+)\]$/i);
  if (!mapped) return ip;
  return mapped.slice(1).flatMap(word => {
    const value = Number.parseInt(word, 16);
    return [value >> IPV4_OCTET_BITS, value & IPV4_OCTET_MASK];
  }).join(".");
}

/** Trust forwarding headers only behind Vercel's ingress. */
export function clientIp(headers: Headers, onVercel = process.env.VERCEL === "1"): string {
  return onVercel
    ? headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip")?.trim() || "unknown"
    : "unknown";
}

export function clientIpBucketKey(headers: Headers, onVercel = process.env.VERCEL === "1"): string {
  return `ip:${createHash("sha256").update(clientIp(headers, onVercel)).digest("hex")}`;
}

/** Invalid addresses never qualify for the connector tier. */
export function matchesCidr(ip: string, cidr: string): boolean {
  try {
    const address = normalizeMappedIpv4(ip);
    const family = isIP(address);
    if (!family) return false;
    return (configuredCidrs.get(cidr) ?? cidrBlockList(cidr)).check(address, family === 4 ? "ipv4" : "ipv6");
  } catch {
    return false;
  }
}
