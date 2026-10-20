// @vitest-environment jsdom
/**
 * The rail guard with a real Removal template card: a line draft is the other
 * pane with unsaved changes (see certification-settings-unsaved-guard.test.tsx
 * for the Emissions form). Only the data hooks are stubbed.
 */
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { entry } from "./removal-template-review-test-support";
import { CertificationSettings } from "./certification-settings";

vi.mock("@/components/ui/tooltip", () => ({
  InfoHint: () => null,
  Tooltip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn() }) }));
vi.mock("nuqs", async () => {
  const react = await import("react");
  return {
    parseAsString: { withOptions: () => ({}) },
    useQueryState: () => react.useState<string | null>("removal-templates"),
  };
});
vi.mock("@/components/navigation", () => ({ SelectFacilityEmptyState: () => null }));
vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({
    facilityId: "11111111-1111-4111-8111-111111111111",
    selectedFacility: { code: "FAC-1", durabilityOption: "1000_year" },
  }),
}));
vi.mock("@/hooks/use-is-admin", () => ({ useIsAdmin: () => false }));
vi.mock("@/hooks/use-organizations", () => ({
  useActiveOrganizationProfile: () => ({ data: { id: "organization-1" } }),
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
vi.mock("./certifier-settings-panel", () => ({ CertifierSettingsPanel: () => <div>Certifier pane</div> }));
vi.mock("./env-banner", () => ({ EnvBanner: () => null }));
vi.mock("./registry-source-visibility-settings", () => ({
  RegistrySourceVisibilitySettings: () => <div>Source visibility policy</div>,
}));

afterEach(cleanup);

const goTo = (label: string) =>
  fireEvent.click(
    Array.from(
      screen.getByRole("navigation", { name: "Certification settings categories" }).querySelectorAll("button"),
    ).find((button) => button.textContent?.includes(label))!,
  );
const accept = () =>
  fireEvent.click(screen.getByRole("button", { name: "Accept proposal for Startup diesel usage" }));

describe("CertificationSettings with the Removal templates pane", () => {
  it("asks before leaving a line draft and keeps the draft on Keep editing", async () => {
    render(<CertificationSettings />);
    accept();

    goTo("Sources");

    expect(await screen.findByText("Discard unsaved changes?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByText("Discard unsaved changes?")).toBeNull());
    expect(screen.queryByText("Source visibility policy")).toBeNull();
    expect(screen.getByRole("button", { name: "Undo changes to Startup diesel usage" })).toBeTruthy();
  });

  it("switches and drops the draft on Discard", async () => {
    render(<CertificationSettings />);
    accept();
    goTo("Sources");

    fireEvent.click(await screen.findByRole("button", { name: "Discard changes" }));

    expect(await screen.findByText("Source visibility policy")).toBeTruthy();
    expect(screen.queryByText("Startup diesel usage")).toBeNull();
  });

  it("switches without asking while no line is edited", () => {
    render(<CertificationSettings />);

    goTo("Sources");

    expect(screen.queryByText("Discard unsaved changes?")).toBeNull();
    expect(screen.getByText("Source visibility policy")).toBeTruthy();
  });
});
