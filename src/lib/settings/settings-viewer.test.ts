import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertSettingsPaneVisible, loadSettingsViewer, type SettingsViewer } from "./settings-viewer";

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
  return { hasOrgRole: actual.hasOrgRole, getOrgContext: context };
});
vi.mock("@/lib/read-models", () => ({
  readActiveOrganization: async () => ({ name: "Org One", slug: "org-one" }),
}));
vi.mock("@/lib/read-models/organization-registry-status", () => ({
  readOrganizationRegistryStatus: async () => registry,
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
  registry.keysSaved = true;
});

describe("loadSettingsViewer", () => {
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
