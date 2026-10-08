import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { clientIpBucketKey } from "./client-ip";

const key = (ip: string) => `ip:${createHash("sha256").update(ip).digest("hex")}`;
it("hashes only the first forwarded address on Vercel", () => {
  const headers = new Headers({ "x-forwarded-for": " 192.0.2.4, 198.51.100.5", "x-real-ip": "203.0.113.6" });
  expect(clientIpBucketKey(headers, true)).toBe(key("192.0.2.4"));
  expect(clientIpBucketKey(headers, true)).not.toContain("192.0.2.4");
});
it("falls back to real IP and then one unknown bucket", () => {
  expect(clientIpBucketKey(new Headers({ "x-forwarded-for": " , ignored", "x-real-ip": "2001:db8::1" }), true)).toBe(key("2001:db8::1"));
  expect(clientIpBucketKey(new Headers(), true)).toBe(key("unknown"));
});
it("ignores untrusted forwarding headers outside Vercel", () => {
  expect(clientIpBucketKey(new Headers({ "x-forwarded-for": "192.0.2.4" }), false)).toBe(key("unknown"));
});
