const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Loopback hostnames as returned by URL.hostname, including bracketed IPv6. */
export function isLocalHost(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname);
}
