/**
 * Every retired settings URL lands on the pane that absorbed it, keeping its
 * query (`?facility=` above all), so old bookmarks and links keep working.
 */
import { describe, expect, it, vi } from "vitest";
import SettingsIndexPage from "./page";
import RetiredApiKeysPage from "./api-keys/page";
import RetiredDefaultsPage from "./defaults/page";
import RetiredOrganizationPage from "./organization/page";
import RetiredVehiclesPage from "./vehicles-and-crew/page";
import RetiredDiagnosticsPage from "./diagnostics/page";
import RetiredTemplateMappingPage from "./template-mapping/page";
import CertificationSettingsPage from "../certification/settings/page";

const context = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/server", () => ({ getOrgContext: context }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
  permanentRedirect: (url: string) => {
    throw new Error(`permanent:${url}`);
  },
}));

const params = (value: Record<string, string>) => ({ searchParams: Promise.resolve(value) });

describe("settings redirects", () => {
  it("opens /settings on General", async () => {
    await expect(SettingsIndexPage(params({}))).rejects.toThrow("redirect:/settings/general");
    await expect(SettingsIndexPage(params({ facility: "f" }))).rejects.toThrow("redirect:/settings/general?facility=f");
  });

  it.each([
    ["organization", RetiredOrganizationPage, "/settings/members"],
    ["defaults", RetiredDefaultsPage, "/settings/general"],
    ["api-keys", RetiredApiKeysPage, "/settings/developers"],
    ["vehicles-and-crew", RetiredVehiclesPage, "/vehicles-and-crew"],
    ["diagnostics", RetiredDiagnosticsPage, "/admin/diagnostics"],
    ["template-mapping", RetiredTemplateMappingPage, "/admin/template-mapping"],
  ])("moves /settings/%s permanently, keeping the facility", async (_name, page, target) => {
    await expect(page(params({ facility: "fac-1" }))).rejects.toThrow(`permanent:${target}?facility=fac-1`);
  });

  it("moves /certification/settings sections onto their panes", async () => {
    context.mockResolvedValue({ isPlatformAdmin: false });
    await expect(CertificationSettingsPage(params({ section: "emission-estimates", facility: "f" }))).rejects.toThrow(
      "permanent:/settings/facilities?facility=f",
    );
    await expect(CertificationSettingsPage(params({}))).rejects.toThrow("permanent:/settings/registry");
    await expect(CertificationSettingsPage(params({ section: "diagnostics" }))).rejects.toThrow(
      "permanent:/settings/registry",
    );
    context.mockResolvedValue({ isPlatformAdmin: true });
    await expect(CertificationSettingsPage(params({ section: "diagnostics" }))).rejects.toThrow(
      "permanent:/admin/diagnostics",
    );
  });
});
