// @vitest-environment jsdom
/**
 * Leaving a pane through the rail drops its draft, so a pane with a draft has
 * to ask first, as the in-place certification panes did. These render the real
 * soil reference form (real RHF dirty state) inside the real console on the
 * Facilities pane; only data hooks and the other parts of the pane are stubbed.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingsViewer } from "@/lib/settings/panes";
import { requestAppLeave, suppressUnloadWarning } from "@/lib/leave-guard";
import { ORG_SWITCH_DISCARD_DESCRIPTION } from "@/lib/org-switch-notice";
import { FacilitySettingsPane } from "./facility-settings-pane";
import { SettingsConsole } from "./settings-console";

const FACILITY_ID = "11111111-1111-4111-8111-111111111111";
const REGISTRY_HREF = `/settings/registry?facility=${FACILITY_ID}`;

const saveMock = vi.hoisted(() => ({ mutateAsync: vi.fn() }));
const router = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/navigation", () => ({
  SelectFacilityEmptyState: () => <div>Select a facility</div>,
}));
vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({
    facilityId: FACILITY_ID,
    selectedFacility: { id: FACILITY_ID, code: "FAC-1", name: "Facility One", durabilityOption: "200_year", version: 1 },
  }),
}));
vi.mock("@/hooks/use-certification", () => ({
  certificationKeys: { all: ["certification"] },
  useFacilityCertifierSummary: () => ({
    data: {
      isProduction: false,
      mapping: { externalProjectId: "prj_1", defaultSoilTemperatureC: null },
      viewerCanManage: true,
    },
    isLoading: false,
  }),
  useSaveFacilityEmissionConfig: () => ({
    mutateAsync: saveMock.mutateAsync,
    isPending: false,
  }),
}));
vi.mock("@/hooks/use-certifier-credentials", () => ({
  useOrgCertifierCredentialsStatus: () => ({ data: { configured: true } }),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn() }) }));
vi.mock("@/components/certification/env-banner", () => ({ EnvBanner: () => null }));
vi.mock("@/components/certification/facility-certifier-section", () => ({
  FacilityCertifierSection: () => <div>Project link</div>,
}));
vi.mock("./durability-tier-settings", () => ({
  DurabilityTierSettings: () => <div>Durability tier</div>,
}));

const viewer: SettingsViewer = {
  organizationId: "organization-1",
  organizationName: "Organization One",
  organizationSlug: "organization-one",
  isPlatformAdmin: false,
  canManage: true,
  canManageApiKeys: true,
  registryKeysSaved: true,
  isProduction: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  saveMock.mutateAsync.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  // A restore from the back-forward cache drops the unload suppression a test set.
  window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
});

const renderPane = () =>
  render(
    <SettingsConsole pane="facilities" viewer={viewer}>
      <FacilitySettingsPane viewer={viewer} />
    </SettingsConsole>,
  );
const goToRegistry = () =>
  fireEvent.click(
    Array.from(
      screen.getByRole("navigation", { name: "Settings categories" }).querySelectorAll("a"),
    ).find((link) => link.textContent?.includes("Registry"))!,
  );
const temperature = () =>
  document.querySelector<HTMLInputElement>("#defaultSoilTemperatureC")!;
const edit = () => fireEvent.change(temperature(), { target: { value: "12.5" } });
const tabCloseWarned = () => {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};
const confirmation = () => screen.queryByText("Discard unsaved changes?");

describe("SettingsConsole unsaved changes", () => {
  it("asks before leaving a pane with a draft", async () => {
    renderPane();
    edit();

    goToRegistry();

    expect(await screen.findByText("Discard unsaved changes?")).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("keeps the pane and the draft when the operator keeps editing", async () => {
    renderPane();
    edit();
    goToRegistry();

    fireEvent.click(await screen.findByRole("button", { name: "Keep editing" }));

    await waitFor(() => expect(confirmation()).toBeNull());
    expect(temperature().value).toBe("12.5");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("leaves when the operator discards", async () => {
    renderPane();
    edit();
    goToRegistry();

    fireEvent.click(await screen.findByRole("button", { name: "Discard changes" }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith(REGISTRY_HREF));
    expect(confirmation()).toBeNull();
  });

  it("leaves without asking when the pane is clean", () => {
    renderPane();

    goToRegistry();

    expect(confirmation()).toBeNull();
    expect(router.push).toHaveBeenCalledWith(REGISTRY_HREF);
  });

  it("does not ask again once the draft is saved", async () => {
    renderPane();
    edit();
    fireEvent.click(screen.getByRole("button", { name: "Save estimates" }));
    // The save resets the form's baseline once it resolves.
    await waitFor(() => expect(tabCloseWarned()).toBe(false));
    expect(saveMock.mutateAsync).toHaveBeenCalled();

    goToRegistry();

    expect(confirmation()).toBeNull();
    expect(router.push).toHaveBeenCalledWith(REGISTRY_HREF);
  });

  it("warns on tab close only while a draft exists", async () => {
    renderPane();
    expect(tabCloseWarned()).toBe(false);

    edit();

    await waitFor(() => expect(tabCloseWarned()).toBe(true));
  });

  it("treats a saved value typed again as clean", async () => {
    renderPane();
    edit();
    fireEvent.click(screen.getByRole("button", { name: "Save estimates" }));
    await waitFor(() => expect(tabCloseWarned()).toBe(false));

    fireEvent.change(temperature(), { target: { value: "13" } });
    await waitFor(() => expect(tabCloseWarned()).toBe(true));
    fireEvent.change(temperature(), { target: { value: "12.5" } });

    await waitFor(() => expect(tabCloseWarned()).toBe(false));
  });

  it("locks the inputs and ignores rail clicks while a save runs", async () => {
    let finish!: () => void;
    saveMock.mutateAsync.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    renderPane();
    edit();
    fireEvent.click(screen.getByRole("button", { name: "Save estimates" }));
    await waitFor(() => expect(temperature().readOnly).toBe(true));

    goToRegistry();

    expect(confirmation()).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(temperature().readOnly).toBe(false));
  });

  it("lets a modified click open the pane in a new tab without asking", () => {
    renderPane();
    edit();
    const link = Array.from(
      screen.getByRole("navigation", { name: "Settings categories" }).querySelectorAll("a"),
    ).find((candidate) => candidate.textContent?.includes("Registry"))!;

    fireEvent.click(link, { metaKey: true });

    expect(confirmation()).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe("app-wide leave guard (the sidebar organization switcher)", () => {
  const OPTIONS = { description: ORG_SWITCH_DISCARD_DESCRIPTION };

  it("runs the leave at once when no pane is mounted", () => {
    const leave = vi.fn();
    requestAppLeave(leave, OPTIONS);
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it("runs the leave at once when the pane is clean", () => {
    renderPane();
    const leave = vi.fn();

    requestAppLeave(leave, OPTIONS);

    expect(leave).toHaveBeenCalledTimes(1);
    expect(confirmation()).toBeNull();
  });

  it("asks with the switching text and does not leave until the operator discards", async () => {
    renderPane();
    edit();
    const leave = vi.fn();

    act(() => requestAppLeave(leave, OPTIONS));

    expect(await screen.findByText(ORG_SWITCH_DISCARD_DESCRIPTION)).toBeTruthy();
    expect(leave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(leave).toHaveBeenCalledTimes(1));
    expect(confirmation()).toBeNull();
  });

  it("keeps the draft and never leaves on Keep editing", async () => {
    renderPane();
    edit();
    const leave = vi.fn();
    act(() => requestAppLeave(leave, OPTIONS));

    fireEvent.click(await screen.findByRole("button", { name: "Keep editing" }));

    await waitFor(() => expect(confirmation()).toBeNull());
    expect(leave).not.toHaveBeenCalled();
    expect(temperature().value).toBe("12.5");
  });

  it("ignores the leave while a save runs", async () => {
    saveMock.mutateAsync.mockReturnValue(new Promise<void>(() => {}));
    renderPane();
    edit();
    fireEvent.click(screen.getByRole("button", { name: "Save estimates" }));
    await waitFor(() => expect(temperature().readOnly).toBe(true));
    const leave = vi.fn();

    act(() => requestAppLeave(leave, OPTIONS));

    expect(confirmation()).toBeNull();
    expect(leave).not.toHaveBeenCalled();
  });

  it("stops registering when the pane unmounts", () => {
    const view = renderPane();
    edit();
    view.unmount();
    const leave = vi.fn();

    requestAppLeave(leave, OPTIONS);

    expect(leave).toHaveBeenCalledTimes(1);
  });

  it("skips the tab-close prompt once a confirmed hard navigation is about to load", async () => {
    renderPane();
    edit();
    await waitFor(() => expect(tabCloseWarned()).toBe(true));

    suppressUnloadWarning();

    expect(tabCloseWarned()).toBe(false);
  });
});
