/**
 * The console frame: the rail groups and their order, the organization name
 * on its group, the attention dots, the phone select, and the pane card lines.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingsViewer } from "@/lib/settings/panes";
import { SettingsConsole } from "./settings-console";

const state = vi.hoisted(() => ({
  configured: true as boolean | undefined,
  mapping: { externalProjectId: "prj_1" } as { externalProjectId: string } | null,
  facilityId: "fac-1" as string | null,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({
    facilityId: state.facilityId,
    selectedFacility: state.facilityId ? { code: "FAC-1", name: "Facility One" } : undefined,
  }),
}));
vi.mock("@/hooks/use-certification", () => ({
  useFacilityCertifierSummary: () => ({
    data: state.facilityId ? { mapping: state.mapping, viewerCanManage: true, isProduction: false } : undefined,
  }),
}));
vi.mock("@/hooks/use-certifier-credentials", () => ({
  useOrgCertifierCredentialsStatus: () => ({
    data: state.configured === undefined ? undefined : { configured: state.configured },
  }),
}));
vi.mock("@/components/certification/env-banner", () => ({ EnvBanner: () => <div>Environment banner</div> }));

const base: SettingsViewer = {
  organizationId: "org-1",
  organizationName: "Dark Earth Carbon",
  isPlatformAdmin: false,
  canManage: true,
  canManageApiKeys: true,
  registryKeysSaved: true,
  isProduction: false,
};

const render = (pane: Parameters<typeof SettingsConsole>[0]["pane"], viewer: Partial<SettingsViewer> = {}) =>
  renderToStaticMarkup(
    <SettingsConsole pane={pane} viewer={{ ...base, ...viewer }}>
      <div>Pane body</div>
    </SettingsConsole>,
  );

const dots = (html: string) => (html.match(/aria-label="Needs attention"/g) ?? []).length;

beforeEach(() => {
  state.configured = true;
  state.mapping = { externalProjectId: "prj_1" };
  state.facilityId = "fac-1";
});

describe("SettingsConsole", () => {
  it("lists the groups in order with the organization name on its group", () => {
    const html = render("general", { isPlatformAdmin: true });
    const order = ["You", "Organization", "Dark Earth Carbon", "Certification"].map((label) =>
      html.indexOf(`>${label}<`),
    );
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Platform pages live under /admin, not in Settings (#1373).
    expect(html).not.toContain(">Platform<");
  });

  it("titles the page after the pane and keeps the caption and footnote", () => {
    const html = render("members");
    expect(html).toContain(">Members</h1>");
    expect(html).toContain("Who can sign in to this organization");
    expect(html).toContain("Admins can change these.");
    expect(html).toContain("Pane body");
  });

  it("links every pane with the working facility", () => {
    const html = render("general");
    expect(html).toContain('href="/settings/registry?facility=fac-1"');
    expect(html).toContain('href="/settings/connected-apps?facility=fac-1"');
  });

  it("offers the rail as one grouped select on phones", () => {
    const html = render("registry");
    expect(html).toContain("Settings page");
    expect(html).toContain('<optgroup label="Organization: Dark Earth Carbon">');
    expect(html).toContain('<option value="/settings/registry?facility=fac-1" selected="">Registry</option>');
  });

  it("names an unlisted current pane in the phone select so every row stays selectable", () => {
    const html = render("developers", { canManage: false, canManageApiKeys: false });
    expect(html).not.toContain(">Developers</a>");
    expect(html).toContain('<option value="" disabled="" selected="">Developers</option>');
  });

  it("hides Removal templates and Facilities while no registry keys are saved, and marks Registry", () => {
    state.configured = false;
    const html = render("registry");
    expect(html).not.toContain(">Removal templates<");
    expect(html).not.toContain(">Facilities<");
    expect(dots(html)).toBe(1);
    expect(html).toContain("Registry (needs attention)");
  });

  it("follows the server's answer for a member, who cannot read the credential status", () => {
    state.configured = undefined;
    expect(render("registry", { canManage: false, registryKeysSaved: false })).not.toContain(">Facilities<");
    expect(render("registry", { canManage: false, registryKeysSaved: true })).toContain(">Facilities<");
  });

  it("marks Facilities while the working facility has no registry project link", () => {
    state.mapping = null;
    expect(dots(render("general"))).toBe(1);
    state.mapping = { externalProjectId: "prj_1" };
    expect(dots(render("general"))).toBe(0);
  });

  it("shows the environment banner on Certification panes only", () => {
    expect(render("registry")).toContain("Environment banner");
    expect(render("general")).not.toContain("Environment banner");
  });

  it("names the working facility in the scope line of facility panes", () => {
    const html = render("facilities");
    expect(html).toContain("Facility One");
    expect(html).toContain("The working facility. Change it with the facility selector.");
    expect(render("general")).not.toContain("The working facility.");
  });
});
