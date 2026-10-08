import { createHash } from "node:crypto";

/** Trust forwarding headers only behind Vercel's ingress. */
export function clientIpBucketKey(headers: Headers, onVercel = process.env.VERCEL === "1"): string {
  const ip = onVercel
    ? headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip")?.trim() || "unknown"
    : "unknown";
  return `ip:${createHash("sha256").update(ip).digest("hex")}`;
}
