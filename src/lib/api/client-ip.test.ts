import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { clientIpBucketKey, matchesCidr } from "./client-ip";

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

it.each(["160.79.104.0", "160.79.104.1", "160.79.111.255"])("matches connector CIDR boundaries: %s", ip => {
  expect(matchesCidr(ip, "160.79.104.0/21")).toBe(true);
});
it.each(["160.79.103.255", "160.79.112.0", "unknown", "160.79.104.256", "160.79.104", "160.79.104.01"])("rejects outside or malformed IPv4: %s", ip => {
  expect(matchesCidr(ip, "160.79.104.0/21")).toBe(false);
});
it.each(["::ffff:160.79.104.1", "::ffff:a04f:6801", "0:0:0:0:0:ffff:a04f:6801"])("normalizes mapped IPv4: %s", ip => {
  expect(matchesCidr(ip, "160.79.104.0/21")).toBe(true);
  expect(matchesCidr(ip, "160.79.112.0/21")).toBe(false);
});
it.each([
  { ip: "2001:db8::", matches: true },
  { ip: "2001:db8:ffff:ffff:ffff:ffff:ffff:ffff", matches: true },
  { ip: "2001:db9::", matches: false },
  { ip: "160.79.104.1", matches: false },
])("matches IPv6 subnets: $ip", ({ ip, matches }) => {
  expect(matchesCidr(ip, "2001:db8::/32")).toBe(matches);
});
it.each(["bad/21", "160.79.104.0/33", "2001:db8::/129", "160.79.104.0"])("rejects invalid configured CIDRs at module load: %s", async cidr => {
  vi.resetModules();
  vi.doMock("@/config/api-rate-limits", () => ({ API_CONNECTOR_EGRESS_CIDRS: [cidr] }));
  try {
    await expect(import("./client-ip")).rejects.toThrow();
  } finally {
    vi.doUnmock("@/config/api-rate-limits");
    vi.resetModules();
  }
});
it("supports host and whole-space masks and refuses invalid CIDRs", () => {
  expect(matchesCidr("255.255.255.255", "0.0.0.0/0")).toBe(true);
  expect(matchesCidr("160.79.104.1", "160.79.104.1/32")).toBe(true);
  expect(matchesCidr("160.79.104.0", "160.79.104.1/32")).toBe(false);
  for (const cidr of ["160.79.104.0", "160.79.104.0/33", "160.79.104.0/-1", "160.79.104.0/21/x", "bad/21"]) {
    expect(matchesCidr("160.79.104.1", cidr)).toBe(false);
  }
});
