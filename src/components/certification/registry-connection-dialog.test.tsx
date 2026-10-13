// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RegistryConnectionDialog } from "./registry-connection-dialog";
import { FacilityCertifierDialog } from "./facility-certifier-dialog";
import { FacilityIsometricConnector } from "./facility-isometric-connector";
import type { FacilityCertifierMapping } from "@/fn/certification/facility-mapping";

vi.mock("@/components/ui/tooltip", () => ({
  InfoHint: () => null,
  Tooltip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn() }) }));
vi.mock("@/hooks/use-organizations", () => ({
  useActiveOrganizationProfile: () => ({ data: { id: "org-1", name: "Organization" }, isLoading: false }),
}));
const mocks = vi.hoisted(() => ({
  configured: true,
  saveKeys: vi.fn(),
  saveMapping: vi.fn(),
  templatesError: null as Error | null,
  liveTemplates: true,
}));
vi.mock("@/hooks/use-certifier-credentials", () => ({
  useOrgCertifierCredentialsStatus: () => ({ data: { configured: mocks.configured, accessTokenLast4: "Uwhl" }, isLoading: false }),
  useSetOrgCertifierCredentials: () => ({ mutateAsync: mocks.saveKeys, isPending: false }),
}));
const loaderData: FacilityCertifierMapping = {
  mapping: null,
  availableProjects: [{ id: "prj_test", name: "Test project", country_code: "TZ", description: null, risk_of_reversal: null, short_description: null }],
  availableTemplates: [], linkHints: [], isProduction: false, isConfigured: true,
};
vi.mock("@/hooks/use-certification", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-certification")>()),
  useFacilityCertifierMapping: () => ({ data: loaderData, isLoading: false }),
  useFacilityCertifierSummary: () => ({ data: { viewerCanManage: true } }),
  useDeleteFacilityCertifierMapping: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useIsometricProjectTemplates: () => ({ data: mocks.liveTemplates ? [{ id: "tpl_test", display_name: "Test template", credit_type: "REMOVAL" }] : undefined, isLoading: false, error: mocks.templatesError }),
  useSaveFacilityCertifierMapping: () => ({ mutateAsync: mocks.saveMapping, isPending: false }),
}));

const FACILITY_ID = "11111111-1111-4111-8111-111111111111";
const close = vi.fn();
beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn().mockImplementation(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  Element.prototype.scrollIntoView = vi.fn();
  vi.clearAllMocks();
  mocks.configured = true;
  loaderData.mapping = null;
  loaderData.availableProjects = [{ id: "prj_test", name: "Test project", country_code: "TZ", description: null, risk_of_reversal: null, short_description: null }];
  loaderData.availableTemplates = [];
  loaderData.linkHints = [];
  loaderData.isProduction = false;
  mocks.templatesError = null;
  mocks.liveTemplates = true;
  mocks.saveKeys.mockResolvedValue({ verification: { ok: true, message: "Connection tested." } });
  mocks.saveMapping.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function mount() {
  render(<RegistryConnectionDialog facilityId={FACILITY_ID} canManage onClose={close} />);
  await screen.findByRole("dialog", { name: "Connect your registry" });
}
function text() { return document.body.textContent ?? ""; }
function button(label: string) {
  return screen.queryByRole("button", { name: label });
}
async function click(label: string) {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: label })); });
}
async function change(name: string, value: string) {
  const field = document.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  await act(async () => { fireEvent.change(field, { target: { value } }); });
}
async function select(label: string, option: string) {
  fireEvent.click(screen.getByRole("combobox", { name: new RegExp(`^${label}`) }));
  fireEvent.click(await screen.findByRole("option", { name: option }));
}
async function dismiss() { await click("Close"); }
async function submit(index: number) {
  await act(async () => { fireEvent.submit(document.querySelectorAll("form")[index]); });
}

describe("Isometric project reselection", () => {
  beforeEach(() => {
    loaderData.availableProjects.push({ ...loaderData.availableProjects[0], id: "prj_other", name: "Other project" });
    loaderData.linkHints = loaderData.availableProjects.map((project) => ({
      externalProjectId: project.id,
      linkedFacilities: [{ facilityId: "facility-other", code: "OTHER", name: "Other facility" }],
    }));
  });

  it("keeps unsaved bindings and sharing acknowledgment on reselect, but resets them for another project", async () => {
    loaderData.mapping = {
      externalProjectId: "prj_test", protocolSlug: "biochar",
      defaultRemovalTemplateId: "tpl_saved", externalFacilityId: "fcl_saved",
    } as NonNullable<FacilityCertifierMapping["mapping"]>;
    render(<FacilityCertifierDialog isOpen onClose={close} facilityId={FACILITY_ID} loaderData={loaderData} />);
    await select("Default Removal template", "Test template: tpl_test");
    await change("externalFacilityId", "fcl_edited");
    const acknowledgment = screen.getByRole("checkbox", { name: "I intend to share this project across facilities." });
    fireEvent.click(acknowledgment);

    await select("Isometric project", "Test project: prj_test");
    expect(screen.getByRole("combobox", { name: /^Default Removal template/ }).textContent).toBe("Test template: tpl_test");
    expect((screen.getByRole("textbox", { name: "Isometric facility ID" }) as HTMLInputElement).value).toBe("fcl_edited");
    expect(acknowledgment).toHaveProperty("checked", true);
    expect(button("Save changes")).toHaveProperty("disabled", false);

    await select("Isometric project", "Other project: prj_other");
    expect(screen.getByRole("combobox", { name: /^Default Removal template/ }).textContent).toBe("No default");
    expect((screen.getByRole("textbox", { name: "Isometric facility ID" }) as HTMLInputElement).value).toBe("");
    expect(acknowledgment).toHaveProperty("checked", false);

    await select("Isometric project", "Test project: prj_test");
    expect(screen.getByRole("combobox", { name: /^Default Removal template/ }).textContent).toBe("tpl_saved");
    expect((screen.getByRole("textbox", { name: "Isometric facility ID" }) as HTMLInputElement).value).toBe("fcl_saved");
  });

  it("keeps connector confirmations on reselect and resets them for another project", async () => {
    loaderData.isProduction = true;
    render(<FacilityIsometricConnector facilityId={FACILITY_ID} />);
    await click("Manage");
    await select("Isometric project", "Test project: prj_test");
    fireEvent.change(screen.getByRole("textbox", { name: "Isometric facility ID" }), { target: { value: "fcl_edited" } });
    const acknowledgments = screen.getAllByRole("checkbox");
    acknowledgments.forEach((checkbox) => fireEvent.click(checkbox));
    expect(button("Connect")).toHaveProperty("disabled", false);

    await select("Isometric project", "Test project: prj_test");
    acknowledgments.forEach((checkbox) => expect(checkbox).toHaveProperty("checked", true));
    expect(button("Connect")).toHaveProperty("disabled", false);
    expect((screen.getByRole("textbox", { name: "Isometric facility ID" }) as HTMLInputElement).value).toBe("fcl_edited");

    await select("Isometric project", "Other project: prj_other");
    acknowledgments.forEach((checkbox) => expect(checkbox).toHaveProperty("checked", false));
    expect(button("Connect")).toHaveProperty("disabled", true);
  });
});

it.each(["live", "loader"])("keeps retained %s templates selectable after a query error", async (source) => {
  mocks.templatesError = new Error("Background refetch failed");
  mocks.liveTemplates = source === "live";
  if (source === "loader") loaderData.availableTemplates = [{
    id: "tpl_test", display_name: "Test template", credit_type: "REMOVAL",
  } as FacilityCertifierMapping["availableTemplates"][number]];
  await mount();
  await select("Isometric project", "Test project: prj_test");
  await select("Default Removal template", "Test template: tpl_test");
  expect(screen.queryByText("Error loading options")).toBeNull();
  await change("externalFacilityId", "fcl_test");
  await submit(1);
  await waitFor(() => expect(mocks.saveMapping).toHaveBeenCalledWith(expect.objectContaining({ defaultRemovalTemplateId: "tpl_test" })));
});

describe("registry connection dialog", () => {
  it("masks saved keys and hides both save and link until there is work to do", async () => {
    await mount();
    expect(within(screen.getByRole("group", { name: "Access token, saved" })).getByText("••••Uwhl").textContent).toBe("••••Uwhl");
    expect(within(screen.getByRole("group", { name: "Client secret, saved" })).getByText("••••••••").textContent).toBe("••••••••");
    expect(button("Save and test connection")).toBeNull();
    expect(button("Link project")).toBeNull();
    await dismiss();
    expect(close).toHaveBeenCalledOnce();
  });

  it("returns to the existing mapping on inline Edit then Cancel and keeps the dialog open", async () => {
    loaderData.mapping = {
      id: "mapping-1", organizationId: "org-1", facilityId: FACILITY_ID,
      provider: "isometric", externalProjectId: "prj_test", protocolSlug: "biochar",
      protocolVersion: null, defaultRemovalTemplateId: null,
      gensetEnergyYieldKwhPerLitre: null, defaultSoilTemperatureC: null,
      defaultSoilTemperatureSource: null, webhookSecret: null,
      externalFacilityId: "fcl_test", metadata: null,
      createdAt: new Date("2026-10-13T00:00:00Z"), updatedAt: new Date("2026-10-13T00:00:00Z"),
    };
    await mount();
    expect(document.querySelectorAll("form")).toHaveLength(1);
    await click("Edit");
    expect(document.querySelectorAll("form")).toHaveLength(2);
    expect(button("Cancel")).not.toBeNull();
    await click("Cancel");
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Connect your registry" })).toBeTruthy();
    expect(document.querySelectorAll("form")).toHaveLength(1);
    expect(text()).toContain("Linked at");
    expect(text()).toContain("prj_test");
    expect(button("Edit")).not.toBeNull();
    expect(button("Cancel")).toBeNull();
    expect(mocks.saveMapping).not.toHaveBeenCalled();
  });

  it("warns on typed replacement keys, keeps input on Keep editing, and discards explicitly", async () => {
    await mount();
    await click("Replace access token");
    expect(button("Save and test connection")).not.toBeNull();
    await change("accessToken", "new-token");
    await dismiss();
    expect(close).not.toHaveBeenCalled();
    expect(text()).toContain("Discard unsaved changes?");
    await click("Keep editing");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Discard unsaved changes?" })).toBeNull());
    expect((screen.getByLabelText("Access token") as HTMLInputElement).value).toBe("new-token");
    await submit(0);
    expect(mocks.saveKeys).toHaveBeenCalledWith({ accessToken: "new-token", clientSecret: undefined });
    expect(button("Save and test connection")).toBeNull();
    await click("Replace access token");
    await change("accessToken", "another-token");
    await dismiss();
    await click("Discard changes");
    expect(close).toHaveBeenCalledOnce();
  });

  it("clears the draft guard when Keep saved key undoes a replacement", async () => {
    await mount();
    await click("Replace access token");
    await change("accessToken", "new-token");
    await click("Keep saved key");
    await dismiss();
    expect(close).toHaveBeenCalledOnce();
    expect(mocks.saveKeys).not.toHaveBeenCalled();
  });

  it("shows an outline Link project after selection and warns until the link is saved", async () => {
    await mount();
    await select("Isometric project", "Test project: prj_test");
    const link = screen.getByRole("button", { name: "Link project" });
    expect(link.className).toContain("border-[var(--color-border-primary)]");
    expect(link.className).toContain("bg-transparent");
    await select("Default Removal template", "Test template: tpl_test");
    await dismiss();
    expect(close).not.toHaveBeenCalled();
    await click("Keep editing");
    await change("externalFacilityId", "fcl_test");
    await submit(1);
    expect(mocks.saveMapping).toHaveBeenCalledWith(expect.objectContaining({ facilityId: FACILITY_ID, externalProjectId: "prj_test", defaultRemovalTemplateId: "tpl_test" }));
    expect(close).toHaveBeenCalledOnce();
  });

  it("a successful project link still warns if replacement keys are unsaved", async () => {
    await mount();
    await click("Replace access token");
    await change("accessToken", "unsaved-token");
    await select("Isometric project", "Test project: prj_test");
    await change("externalFacilityId", "fcl_test");
    await submit(1);
    expect(mocks.saveMapping).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    expect(text()).toContain("Discard unsaved changes?");
    await click("Keep editing");
    await submit(0);
    expect(mocks.saveKeys).toHaveBeenCalledWith({ accessToken: "unsaved-token", clientSecret: undefined });
  });

  it("offers save and test for first-time credentials and guards their draft", async () => {
    mocks.configured = false;
    await mount();
    expect(button("Save and test connection")).not.toBeNull();
    await change("clientSecret", "unsaved-secret");
    await dismiss();
    expect(close).not.toHaveBeenCalled();
    expect(text()).toContain("Discard unsaved changes?");
  });

  it("saving keys does not discard a selected but unlinked project", async () => {
    await mount();
    await select("Isometric project", "Test project: prj_test");
    await click("Replace access token");
    await change("accessToken", "new-token");
    await submit(0);
    await dismiss();
    expect(close).not.toHaveBeenCalled();
    expect(text()).toContain("Discard unsaved changes?");
  });

  it("preserves keys and the guard after a failed save", async () => {
    await mount();
    mocks.saveKeys.mockRejectedValue(new Error("Keys were not saved."));
    await click("Replace access token");
    await change("accessToken", "new-token");
    await submit(0);
    expect(text()).toContain("Keys were not saved.");
    expect((screen.getByLabelText("Access token") as HTMLInputElement).value).toBe("new-token");
    await dismiss();
    expect(close).not.toHaveBeenCalled();
  });

  it("prevents dismissal during a save and clears the guard afterwards", async () => {
    await mount();
    let release!: (result: unknown) => void;
    mocks.saveKeys.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    await click("Replace access token");
    await change("accessToken", "new-token");
    await submit(0);
    await waitFor(() => expect((screen.getByRole("button", { name: "Close" }) as HTMLButtonElement).disabled).toBe(true));
    await dismiss();
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Connect your registry" }), { key: "Escape" });
    expect(close).not.toHaveBeenCalled();
    await act(async () => {
      release({ verification: { ok: true, message: "Connection tested." } });
    });
    await waitFor(() => expect((screen.getByRole("button", { name: "Close" }) as HTMLButtonElement).disabled).toBe(false));
    await dismiss();
    expect(close).toHaveBeenCalledOnce();
  });

  it("protects project selection in the normal settings dialog too", async () => {
    render(<FacilityCertifierDialog isOpen onClose={close} facilityId={FACILITY_ID} loaderData={loaderData} />);
    await screen.findByRole("dialog", { name: "Link Isometric project" });
    await select("Isometric project", "Test project: prj_test");
    await dismiss();
    expect(close).not.toHaveBeenCalled();
    await click("Keep editing");
    await change("externalFacilityId", "fcl_test");
    await submit(0);
    expect(close).toHaveBeenCalledOnce();
  });
});
