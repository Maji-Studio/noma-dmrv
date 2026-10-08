import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/data-access/api-me", () => ({ getApiMeOrganization: vi.fn().mockResolvedValue({
  organization: { id: "org", name: "Operator" },
  facilities: [
    { id: "east", code: "E", name: "East", timeZone: "Pacific/Kiritimati" },
    { id: "west", code: "W", name: "West", timeZone: "America/Los_Angeles" },
  ],
}) }));
import { readApiMe } from "./api-me";
import type { ApiContext } from "@/lib/auth/api-context";

afterEach(() => vi.useRealTimers());
it("uses each facility's current calendar day at the same instant", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-07T01:00:00Z"));
  const ctx: ApiContext = {
    userId: "owner", organizationId: "org", orgRole: "admin", isPlatformAdmin: false,
    credentialId: "key-id", principal: { userId: "owner", credentialId: "key-id", kind: "api-key" },
    scopes: [], credential: { id: "key-id", name: "Intake", expiresAt: new Date("2026-12-01T00:00:00Z") },
  };
  const result = await readApiMe(ctx);
  expect(result.facilities.map(({ today }) => today)).toEqual(["2026-10-07", "2026-10-06"]);
  expect(result.credential.expiresAt).toBe("2026-12-01T00:00:00.000Z");
});
