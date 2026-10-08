import { describe, expect, it, vi } from "vitest";
import ApiKeysPage from "./page";

const context = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/server", () => ({ getOrgContext: context }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect"); } }));
vi.mock("@/components/api-keys", () => ({ ApiKeySettings: () => null }));
vi.mock("@/components/settings", () => ({ SettingsConsole: () => null }));

describe("API key settings route", () => {
  it.each([
    ["owner", false, true],
    ["admin", false, true],
    ["member", false, false],
    [null, true, false],
    ["member", true, false],
    ["owner", true, true],
  ])("gates controls by live membership role %s (platform %s)", async (orgRole, isPlatformAdmin, expected) => {
    context.mockResolvedValue({ orgRole, isPlatformAdmin, organizationId: "org-1" });
    const view = await ApiKeysPage();
    expect(view.props.canManageApiKeys).toBe(expected);
    expect(view.props.children.props.canManage).toBe(expected);
  });

  it("redirects when no organization is active", async () => {
    context.mockResolvedValue(null);
    await expect(ApiKeysPage()).rejects.toThrow("redirect");
  });
});
