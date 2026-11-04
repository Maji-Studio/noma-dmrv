import { describe, expect, it } from "vitest";
import { homePathFor, isPlatformPath, MEMBER_HOME_HREF, PLATFORM_HOME_HREF } from "./home-path";

describe("homePathFor", () => {
  it("sends Platform Admins to the Platform home", () => {
    expect(homePathFor({ role: "admin" })).toBe(PLATFORM_HOME_HREF);
    expect(PLATFORM_HOME_HREF).toBe("/platform/organizations");
  });

  it.each([{ role: "user" }, {}, { role: null }, null, undefined])(
    "sends non-admin users to the dashboard: %j",
    (user) => {
      expect(homePathFor(user)).toBe(MEMBER_HOME_HREF);
      expect(MEMBER_HOME_HREF).toBe("/dashboard");
    },
  );
});

describe("isPlatformPath", () => {
  it.each([
    ["/platform", true],
    ["/platform/organizations", true],
    ["/administration", false],
    ["/dashboard", false],
    [null, false],
  ])("%s -> %s", (path, expected) => {
    expect(isPlatformPath(path)).toBe(expected);
  });
});
