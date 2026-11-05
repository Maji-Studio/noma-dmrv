import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertSettingsPaneVisible, loadSettingsViewer, type SettingsViewer } from "./settings-viewer";

import { settingsPaneGroups, SETTINGS_PANES } from "./panes";
import { readActiveOrganization } from "@/lib/read-models";
import { readOrganizationRegistryStatus } from "@/lib/read-models/organization-registry-status";

const auth = vi.hoisted(() => vi.fn());
const context = vi.hoisted(() => vi.fn());
const registry = vi.hoisted(() => ({ keysSaved: true, isProduction: false }));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("@/lib/auth/server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/server")>("@/lib/auth/server");
  return { hasOrgRole: actual.hasOrgRole, getOrgContext: context, requireAuth: auth };
});
vi.mock("@/lib/read-models", () => ({
  readActiveOrganization: vi.fn(async () => ({ name: "Org One", slug: "org-one" })),
}));
vi.mock("@/lib/read-models/organization-registry-status", () => ({
  readOrganizationRegistryStatus: vi.fn(async () => registry),
}));

const viewer: SettingsViewer = {
  organizationId: "org-1",
  organizationName: "Org One",
  isPlatformAdmin: false,
  canManage: false,
  canManageApiKeys: false,
  registryKeysSaved: true,
  isProduction: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue({ id: "user-1", role: "user" });
  registry.keysSaved = true;
});

describe("loadSettingsViewer", () => {
  it.each(["user", "admin"])("shows only Profile without an organization for %s", async (role) => {
    context.mockResolvedValue(null);
    auth.mockResolvedValue({ id: "user-1", role });
    const result = await loadSettingsViewer("profile");
    expect(result.ctx).toBeNull();
    expect(readActiveOrganization).not.toHaveBeenCalled();
    expect(readOrganizationRegistryStatus).not.toHaveBeenCalled();
    expect(result.viewer).toMatchObject({ organizationId: null, organizationName: null, canManage: false });
    expect(settingsPaneGroups(result.viewer).map((group) => ({ key: group.key, panes: group.panes.map((pane) => pane.key) })))
      .toEqual([{ key: "you", panes: ["profile"] }]);
    expect(() => assertSettingsPaneVisible(result.viewer, "profile")).not.toThrow();
    for (const pane of SETTINGS_PANES.filter((pane) => pane.key !== "profile")) {
      expect(() => assertSettingsPaneVisible(result.viewer, pane.key)).toThrow("redirect:/dashboard");
    }
  });

  it("requires a session for the no-org Profile route", async () => {
    context.mockResolvedValue(null);
    auth.mockImplementation(() => { throw new Error("redirect:/login"); });
    await expect(loadSettingsViewer("profile")).rejects.toThrow("redirect:/login");
  });

  it.each([
    ["admin", false, true, true],
    ["member", false, false, false],
    [null, true, true, false],
    ["member", true, true, false],
    ["admin", true, true, true],
  ])("role %s (platform %s) manages %s and owns API keys %s", async (orgRole, isPlatformAdmin, canManage, canManageApiKeys) => {
    context.mockResolvedValue({ orgRole, isPlatformAdmin, organizationId: "org-1", userId: "user-1" });
    const { viewer: loaded } = await loadSettingsViewer();
    expect(loaded.canManage).toBe(canManage);
    expect(loaded.canManageApiKeys).toBe(canManageApiKeys);
    expect(loaded.organizationName).toBe("Org One");
    expect(loaded.registryKeysSaved).toBe(true);
  });

  it("sends a caller without an active organization to the dashboard", async () => {
    context.mockResolvedValue(null);
    await expect(loadSettingsViewer()).rejects.toThrow("redirect:/dashboard");
  });
});

describe("assertSettingsPaneVisible", () => {
  it("answers 404 for a pane outside the viewer's audience", () => {
    expect(() => assertSettingsPaneVisible(viewer, "developers")).toThrow("notFound");
    expect(() => assertSettingsPaneVisible({ ...viewer, canManageApiKeys: true }, "developers")).not.toThrow();
    expect(() => assertSettingsPaneVisible({ ...viewer, isPlatformAdmin: true }, "developers")).not.toThrow();
  });

  it("answers a pane that waits on registry keys with Registry, keeping the facility", () => {
    const noKeys = { ...viewer, registryKeysSaved: false };
    expect(() => assertSettingsPaneVisible(noKeys, "facilities", { facility: "fac-1" })).toThrow(
      "redirect:/settings/registry?facility=fac-1",
    );
    expect(() => assertSettingsPaneVisible(noKeys, "removal-templates")).toThrow("redirect:/settings/registry");
    expect(() => assertSettingsPaneVisible(viewer, "facilities")).not.toThrow();
  });
});
