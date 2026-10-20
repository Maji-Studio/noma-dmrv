// @vitest-environment jsdom
/**
 * The rail guard with a real Removal template card: a line draft is the other
 * pane with unsaved changes (see settings-console-unsaved-guard.test.tsx for
 * the soil reference form). Only the data hooks are stubbed.
 */
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { entry } from "@/components/certification/removal-template-review-test-support";
import type { SettingsViewer } from "@/lib/settings/panes";
import { RemovalTemplatesSettingsPane } from "./removal-templates-settings-pane";
import { SettingsConsole } from "./settings-console";

const FACILITY_ID = "11111111-1111-4111-8111-111111111111";
const router = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/ui/tooltip", () => ({
  InfoHint: () => null,
  Tooltip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn() }) }));
vi.mock("nuqs", () => ({ useQueryState: () => [null, vi.fn()] }));
vi.mock("@/components/navigation", () => ({ SelectFacilityEmptyState: () => null }));
vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({
    facilityId: FACILITY_ID,
    selectedFacility: { code: "FAC-1", name: "Facility One", durabilityOption: "1000_year" },
  }),
}));
vi.mock("@/hooks/use-certification", () => ({
  certificationKeys: { all: ["certification"] },
  useFacilityCertifierSummary: () => ({
    data: { isProduction: false, mapping: null, viewerCanManage: true },
    isLoading: false,
  }),
}));
vi.mock("@/hooks/use-certifier-credentials", () => ({
  useOrgCertifierCredentialsStatus: () => ({ data: { configured: true } }),
}));
vi.mock("@/hooks/use-removal-template-review", () => ({
  useRemovalTemplateReview: () => ({
    data: [entry()], isLoading: false, isError: false, isFetching: false, refetch: vi.fn(),
  }),
  useReviewRemovalTemplateLines: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSetFacilityDefaultRemovalTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useStartRemovalTemplateSetup: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemovalTemplateReviewEntry: () => ({
    data: undefined, isLoading: false, isError: false, isFetching: false, refetch: vi.fn(),
  }),
}));
vi.mock("@/components/certification/env-banner", () => ({ EnvBanner: () => null }));

const viewer: SettingsViewer = {
  organizationId: "organization-1",
  organizationName: "Organization One",
  organizationSlug: null,
  isPlatformAdmin: false,
  canManage: true,
  canManageApiKeys: true,
  registryKeysSaved: true,
  isProduction: false,
};

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const renderPane = () =>
  render(
    <SettingsConsole pane="removal-templates" viewer={viewer}>
      <RemovalTemplatesSettingsPane viewer={viewer} />
    </SettingsConsole>,
  );
const goToRegistry = () =>
  fireEvent.click(
    Array.from(
      screen.getByRole("navigation", { name: "Settings categories" }).querySelectorAll("a"),
    ).find((link) => link.textContent?.includes("Registry"))!,
  );
const accept = () =>
  fireEvent.click(screen.getByRole("button", { name: "Accept proposal for Startup diesel usage" }));

describe("SettingsConsole with the Removal templates pane", () => {
  it("asks before leaving a line draft and keeps the draft on Keep editing", async () => {
    renderPane();
    accept();

    goToRegistry();

    expect(await screen.findByText("Discard unsaved changes?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByText("Discard unsaved changes?")).toBeNull());
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Undo changes to Startup diesel usage" })).toBeTruthy();
  });

  it("leaves and drops the draft on Discard", async () => {
    renderPane();
    accept();
    goToRegistry();

    fireEvent.click(await screen.findByRole("button", { name: "Discard changes" }));

    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(`/settings/registry?facility=${FACILITY_ID}`),
    );
  });

  it("leaves without asking while no line is edited", () => {
    renderPane();

    goToRegistry();

    expect(screen.queryByText("Discard unsaved changes?")).toBeNull();
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it("says the pane is for the working facility", () => {
    renderPane();

    expect(screen.getByText("Facility One")).toBeTruthy();
    expect(screen.getByText("The working facility. Change it with the facility selector.")).toBeTruthy();
  });
});
