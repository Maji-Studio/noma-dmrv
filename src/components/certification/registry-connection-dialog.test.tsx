import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Modal } from "@/components/ui/modal";
import { FormActions } from "@/components/forms/form-actions";
import { RegistryConnectionDialog } from "./registry-connection-dialog";
import { FacilityCertifierDialog } from "./facility-certifier-dialog";
import type { FacilityCertifierMapping } from "@/fn/certification/facility-mapping";

vi.mock("@/components/ui/modal", () => ({
  Modal: ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) => isOpen ? <div>{children}</div> : null,
}));
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
}));
vi.mock("@/hooks/use-certifier-credentials", () => ({
  useOrgCertifierCredentialsStatus: () => ({ data: { configured: mocks.configured, accessTokenLast4: "Uwhl" }, isLoading: false }),
  useSetOrgCertifierCredentials: () => ({ mutateAsync: mocks.saveKeys, isPending: false }),
}));
const loaderData = {
  mapping: null,
  availableProjects: [{ id: "prj_test", name: "Test project", country_code: "TZ", description: null, risk_of_reversal: null, short_description: null }],
  availableTemplates: [], linkHints: [], isProduction: false, isConfigured: true,
} satisfies FacilityCertifierMapping;
vi.mock("@/hooks/use-certification", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-certification")>()),
  useFacilityCertifierMapping: () => ({ data: loaderData, isLoading: false }),
  useDeleteFacilityCertifierMapping: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useIsometricProjectTemplates: () => ({ data: [], isLoading: false }),
  useSaveFacilityCertifierMapping: () => ({ mutateAsync: mocks.saveMapping, isPending: false }),
}));

const FACILITY_ID = "11111111-1111-4111-8111-111111111111";
let renderer: ReactTestRenderer;
const close = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  mocks.configured = true;
  mocks.saveKeys.mockResolvedValue({ verification: { ok: true, message: "Connection tested." } });
  mocks.saveMapping.mockResolvedValue({});
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
});

async function mount() {
  await act(async () => {
    renderer = create(<RegistryConnectionDialog facilityId={FACILITY_ID} canManage onClose={close} />);
  });
}
function text() { return JSON.stringify(renderer.toJSON()); }
function button(label: string) {
  return renderer.root.findAllByType("button").find((node) => node.children.includes(label) || node.props["aria-label"] === label)!;
}
async function click(label: string) { await act(async () => button(label).props.onClick()); }
async function change(name: string, value: string) {
  const field = renderer.root.findAll((node) => (node.type === "input" || node.type === "select") && node.props.name === name)[0];
  await act(async () => { await field.props.onChange({ target: { name, value } }); });
}
async function dismiss() {
  await act(async () => renderer.root.findAllByType(Modal)[0].props.onClose());
}
async function submit(index: number) {
  await act(async () => {
    await renderer.root.findAllByType("form")[index].props.onSubmit({ preventDefault() {}, persist() {} });
  });
}

describe("registry connection dialog", () => {
  it("masks saved keys and hides both save and link until there is work to do", async () => {
    await mount();
    expect(text()).toContain("••••Uwhl");
    expect(text()).toContain("••••••••");
    expect(button("Save and test connection")).toBeUndefined();
    expect(button("Link project")).toBeUndefined();
    await dismiss();
    expect(close).toHaveBeenCalledOnce();
  });

  it("warns on typed replacement keys, keeps input on Keep editing, and discards explicitly", async () => {
    await mount();
    await click("Replace access token");
    expect(button("Save and test connection")).toBeDefined();
    await change("accessToken", "new-token");
    await dismiss();
    expect(close).not.toHaveBeenCalled();
    expect(text()).toContain("Discard unsaved changes?");
    await click("Keep editing");
    expect(text()).not.toContain("Discard unsaved changes?");
    await submit(0);
    expect(mocks.saveKeys).toHaveBeenCalledWith({ accessToken: "new-token", clientSecret: undefined });
    expect(button("Save and test connection")).toBeUndefined();
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
    await change("externalProjectId", "prj_test");
    const linkActions = renderer.root.findAllByType(FormActions).find((node) => node.props.submitLabel === "Link project")!;
    expect(linkActions.props.showSubmit).toBe(true);
    expect(linkActions.props.submitVariant).toBe("default");
    await dismiss();
    expect(close).not.toHaveBeenCalled();
    await click("Keep editing");
    await change("externalFacilityId", "fcl_test");
    await submit(1);
    expect(mocks.saveMapping).toHaveBeenCalledWith(expect.objectContaining({ facilityId: FACILITY_ID, externalProjectId: "prj_test" }));
    expect(close).toHaveBeenCalledOnce();
  });

  it("a successful project link still warns if replacement keys are unsaved", async () => {
    await mount();
    await click("Replace access token");
    await change("accessToken", "unsaved-token");
    await change("externalProjectId", "prj_test");
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
    expect(button("Save and test connection")).toBeDefined();
    await change("clientSecret", "unsaved-secret");
    await dismiss();
    expect(close).not.toHaveBeenCalled();
    expect(text()).toContain("Discard unsaved changes?");
  });

  it("saving keys does not discard a selected but unlinked project", async () => {
    await mount();
    await change("externalProjectId", "prj_test");
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
    await dismiss();
    expect(close).not.toHaveBeenCalled();
  });

  it("prevents dismissal during a save and clears the guard afterwards", async () => {
    await mount();
    let release!: (result: unknown) => void;
    mocks.saveKeys.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    await click("Replace access token");
    await change("accessToken", "new-token");
    let saving!: Promise<void>;
    await act(async () => {
      saving = renderer.root.findAllByType("form")[0].props.onSubmit({ preventDefault() {}, persist() {} });
    });
    expect(renderer.root.findAllByType(Modal)[0].props.dismissible).toBe(false);
    await dismiss();
    expect(close).not.toHaveBeenCalled();
    await act(async () => {
      release({ verification: { ok: true, message: "Connection tested." } });
      await saving;
    });
    await dismiss();
    expect(close).toHaveBeenCalledOnce();
  });

  it("protects project selection in the normal settings dialog too", async () => {
    await act(async () => {
      renderer = create(<FacilityCertifierDialog isOpen onClose={close} facilityId={FACILITY_ID} loaderData={loaderData} />);
    });
    await change("externalProjectId", "prj_test");
    await dismiss();
    expect(close).not.toHaveBeenCalled();
    await click("Keep editing");
    await change("externalFacilityId", "fcl_test");
    await submit(0);
    expect(close).toHaveBeenCalledOnce();
  });
});
