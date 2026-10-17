// @vitest-environment jsdom
/**
 * Switching rail sections unmounts the pane, so a pane with a draft has to ask
 * first. These render the real Emissions form (real RHF dirty state) inside the
 * real console; only data hooks and the other panes are stubbed.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CertificationSettings } from "./certification-settings";

const saveMock = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

// A real, stateful `?section=` so a confirmed leave actually swaps the pane.
vi.mock("nuqs", async () => {
  const react = await import("react");
  return {
    parseAsString: { withOptions: () => ({}) },
    useQueryState: () => react.useState<string | null>("emission-estimates"),
  };
});

vi.mock("@/components/navigation", () => ({
  SelectFacilityEmptyState: () => <div>Select a facility</div>,
}));
vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({
    facilityId: "11111111-1111-4111-8111-111111111111",
    selectedFacility: { code: "FAC-1", durabilityOption: "200_year" },
  }),
}));
vi.mock("@/hooks/use-is-admin", () => ({ useIsAdmin: () => false }));
vi.mock("@/hooks/use-organizations", () => ({
  useActiveOrganizationProfile: () => ({ data: { id: "organization-1" } }),
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
vi.mock("./certifier-settings-panel", () => ({
  CertifierSettingsPanel: () => <div>Certifier pane</div>,
}));
vi.mock("./env-banner", () => ({ EnvBanner: () => null }));
vi.mock("./registry-source-visibility-settings", () => ({
  RegistrySourceVisibilitySettings: () => <div>Source visibility policy</div>,
}));
vi.mock("./removal-template-review-panel", () => ({
  RemovalTemplateReviewPanel: () => <div>Removal templates pane</div>,
}));

beforeEach(() => {
  vi.clearAllMocks();
  saveMock.mutateAsync.mockResolvedValue({});
});
afterEach(cleanup);

const rail = () =>
  screen.getByRole("navigation", { name: "Certification settings categories" });
const goTo = (label: string) =>
  fireEvent.click(
    Array.from(rail().querySelectorAll("button")).find(
      (button) => button.textContent?.includes(label),
    )!,
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

describe("CertificationSettings unsaved changes", () => {
  it("asks before leaving a pane with a draft", async () => {
    render(<CertificationSettings />);
    edit();

    goTo("Sources");

    expect(await screen.findByText("Discard unsaved changes?")).toBeTruthy();
    expect(screen.queryByText("Source visibility policy")).toBeNull();
  });

  it("keeps the pane and the draft when the operator keeps editing", async () => {
    render(<CertificationSettings />);
    edit();
    goTo("Sources");

    fireEvent.click(await screen.findByRole("button", { name: "Keep editing" }));

    await waitFor(() => expect(confirmation()).toBeNull());
    expect(temperature().value).toBe("12.5");
    expect(screen.queryByText("Source visibility policy")).toBeNull();
  });

  it("switches and drops the draft when the operator discards", async () => {
    render(<CertificationSettings />);
    edit();
    goTo("Sources");

    fireEvent.click(await screen.findByRole("button", { name: "Discard changes" }));

    expect(await screen.findByText("Source visibility policy")).toBeTruthy();
    expect(confirmation()).toBeNull();
    expect(document.querySelector("#defaultSoilTemperatureC")).toBeNull();
  });

  it("switches without asking when the pane is clean", () => {
    render(<CertificationSettings />);

    goTo("Sources");

    expect(confirmation()).toBeNull();
    expect(screen.getByText("Source visibility policy")).toBeTruthy();
  });

  it("does not ask again once the draft is saved", async () => {
    render(<CertificationSettings />);
    edit();
    fireEvent.click(screen.getByRole("button", { name: "Save estimates" }));
    // The save resets the form's baseline once it resolves.
    await waitFor(() => expect(tabCloseWarned()).toBe(false));
    expect(saveMock.mutateAsync).toHaveBeenCalled();

    goTo("Sources");

    await waitFor(() =>
      expect(screen.getByText("Source visibility policy")).toBeTruthy(),
    );
    expect(confirmation()).toBeNull();
  });

  it("warns on tab close only while a draft exists", async () => {
    render(<CertificationSettings />);
    expect(tabCloseWarned()).toBe(false);

    edit();

    await waitFor(() => expect(tabCloseWarned()).toBe(true));
  });
});
