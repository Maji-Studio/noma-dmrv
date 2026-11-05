/** The settings index opens General and preserves the working facility. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsIndexPage from "./page";

const auth = vi.hoisted(() => ({ getOrgContext: vi.fn() }));
vi.mock("@/lib/auth/server", () => auth);

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const params = (value: Record<string, string>) => ({ searchParams: Promise.resolve(value) });

beforeEach(() => {
  auth.getOrgContext.mockResolvedValue({ userId: "user-1", organizationId: "org-1", orgRole: "member", isPlatformAdmin: false });
});

describe("settings redirects", () => {
  it("opens /settings on Profile without an organization", async () => {
    auth.getOrgContext.mockResolvedValue(null);
    await expect(SettingsIndexPage(params({ facility: "f" }))).rejects.toThrow("redirect:/settings/profile");
  });

  it("opens /settings on General", async () => {
    await expect(SettingsIndexPage(params({}))).rejects.toThrow("redirect:/settings/general");
    await expect(SettingsIndexPage(params({ facility: "f" }))).rejects.toThrow("redirect:/settings/general?facility=f");
  });
});
