// @vitest-environment jsdom
/**
 * The rail guard with a real Removal template card: a line draft is the other
 * pane with unsaved changes (see certification-settings-unsaved-guard.test.tsx
 * for the Emissions form). Only the data hooks are stubbed.
 */
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RemovalTemplateReviewEntry } from "./removal-template-review-model";
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
}));
vi.mock("./certifier-settings-panel", () => ({ CertifierSettingsPanel: () => <div>Certifier pane</div> }));
vi.mock("./env-banner", () => ({ EnvBanner: () => null }));
vi.mock("./registry-source-visibility-settings", () => ({
  RegistrySourceVisibilitySettings: () => <div>Source visibility policy</div>,
}));

const OBSERVATION_ID = "22222222-2222-4222-8222-222222222222";

function component(id: string, displayName: string) {
  return {
    id, displayName, description: null, blueprintKey: "fuel_usage_by_volume",
    inputs: [{ key: "volume", type: "monitored", quantityKind: "volume" }],
  };
}

function entry(overrides: Record<string, unknown> = {}): RemovalTemplateReviewEntry {
  return {
    templateId: "rvt_test",
    template: { id: "rvt_test", display_name: "Dark Earth Carbon Template", credit_type: "REMOVAL" },
    observation: { id: OBSERVATION_ID, version: 3, enrichment: { cmp_startup: { volume: { unit: "L" } } } },
    isDefault: true,
    availability: "listed",
    changes: {},
    lines: [
      {
        component: component("cmp_startup", "Startup diesel usage"), groupKey: "operations", groupName: "Operations",
        contract: { scope: "operating", automaticSource: "run-startup-diesel", entryPolicy: "additive", origin: "proposed" },
        catalogCandidates: ["run-startup-diesel"], allowedEntryPolicies: ["none", "additive"], change: "added",
      },
      {
        component: component("cmp_lab", "Lab electricity"), groupKey: "operations", groupName: "Operations",
        contract: { scope: "operating", entryPolicy: "additive", origin: "reviewed" },
        catalogCandidates: [], allowedEntryPolicies: ["none", "additive"], change: "unchanged",
      },
    ],
    enrichmentProblems: [],
    lineSourceProblems: [{ code: "unassigned", componentId: "cmp_startup" }],
    ...overrides,
  } as unknown as RemovalTemplateReviewEntry;
}


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
