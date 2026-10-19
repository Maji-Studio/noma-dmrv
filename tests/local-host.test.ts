import { describe, expect, it } from "vitest";
import { isLocalHost } from "./helpers/local-host";

describe("isLocalHost", () => {
  it.each(["localhost", "127.0.0.1", "[::1]"])("treats %s as local", (host) => {
    expect(isLocalHost(host)).toBe(true);
  });

  it("treats anything else as remote", () => {
    expect(isLocalHost("db.example.com")).toBe(false);
  });
});
