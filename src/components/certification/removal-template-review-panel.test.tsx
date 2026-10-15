// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StaleVersionError, STALE_VERSION_CONFLICT_CODE, STALE_VERSION_MESSAGE } from "@/lib/stale-version";
import { RemovalTemplateReviewPanel } from "./removal-template-review-panel";
import type { RemovalTemplateReviewEntry } from "./removal-template-review-model";

vi.mock("@/components/ui/tooltip", () => ({
  InfoHint: () => null,
  Tooltip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn() }) }));

const mocks = vi.hoisted(() => ({
  data: [] as unknown[],
  refetch: vi.fn(),
  mutateAsync: vi.fn(),
}));
vi.mock("@/hooks/use-removal-template-review", () => ({
  useRemovalTemplateReview: () => ({
    data: mocks.data, isLoading: false, isError: false, isFetching: false, refetch: mocks.refetch,
  }),
  useReviewRemovalTemplateLines: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
}));

const FACILITY_ID = "11111111-1111-4111-8111-111111111111";
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
    observation: { id: OBSERVATION_ID, version: 3, enrichment: {} },
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.data = [entry()];
  mocks.mutateAsync.mockResolvedValue({});
});
afterEach(cleanup);

const saveButton = () => screen.getByRole("button", { name: /^Save/ });

describe("RemovalTemplateReviewPanel", () => {
  it("is read-only for members and still flags the line that needs review", () => {
    render(<RemovalTemplateReviewPanel facilityId={FACILITY_ID} canManage={false} />);

    expect(screen.getByText("Dark Earth Carbon Template")).toBeTruthy();
    expect(screen.getByText("Default")).toBeTruthy();
    expect(screen.getByText("Needs review")).toBeTruthy();
    expect(screen.getByText("Ask an Owner or Admin to review the lines marked Needs review.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Accept proposal/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Change/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Save/ })).toBeNull();
  });

  it("saves a proposed line accepted unchanged against the loaded version", async () => {
    render(<RemovalTemplateReviewPanel facilityId={FACILITY_ID} canManage />);
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Accept proposal for Startup diesel usage" }));
    });
    expect(screen.getByText("Not saved")).toBeTruthy();
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false);

    await act(async () => { fireEvent.click(saveButton()); });
    expect(mocks.mutateAsync).toHaveBeenCalledWith({
      observationId: OBSERVATION_ID,
      expectedVersion: 3,
      assignments: {
        cmp_startup: { scope: "operating", automaticSource: "run-startup-diesel", entryPolicy: "additive" },
      },
    });
  });

  it("assigns a contract through the line controls", async () => {
    render(<RemovalTemplateReviewPanel facilityId={FACILITY_ID} canManage />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Change Lab electricity" })); });
    const scope = document.getElementById("rvt_test-cmp_lab-scope") as HTMLSelectElement;
    await act(async () => { fireEvent.change(scope, { target: { value: "forbidden" } }); });
    // Only operating lines take entries, so the policy resets with the scope.
    expect((document.getElementById("rvt_test-cmp_lab-entries") as HTMLSelectElement).disabled).toBe(true);

    await act(async () => { fireEvent.click(saveButton()); });
    expect(mocks.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      assignments: { cmp_lab: { scope: "forbidden", entryPolicy: "none" } },
    }));
  });

  it("disables saving and offers a retry while the template is not fully read", async () => {
    mocks.data = [entry({
      enrichmentProblems: [{ code: "unknown-enrichment", componentId: "cmp_startup", inputKey: "volume" }],
    })];
    render(<RemovalTemplateReviewPanel facilityId={FACILITY_ID} canManage />);

    expect(screen.getByText("Template not fully read")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Accept proposal for Startup diesel usage" }));
    });
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry" })); });
    expect(mocks.refetch).toHaveBeenCalled();
  });

  it("keeps the draft and reloads after a stale save", async () => {
    mocks.mutateAsync.mockRejectedValue(new StaleVersionError(STALE_VERSION_MESSAGE, {
      entity: "removal_template_observation", id: OBSERVATION_ID, code: STALE_VERSION_CONFLICT_CODE,
    }));
    render(<RemovalTemplateReviewPanel facilityId={FACILITY_ID} canManage />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Accept proposal for Startup diesel usage" }));
    });
    await act(async () => { fireEvent.click(saveButton()); });

    expect(screen.getByText(STALE_VERSION_MESSAGE)).toBeTruthy();
    expect(screen.getByText("Not saved")).toBeTruthy();
    expect(mocks.refetch).toHaveBeenCalled();
  });

  it("shows a missing template with no lines to review", () => {
    mocks.data = [entry({ template: null, observation: null, availability: "missing", lines: [], lineSourceProblems: [] })];
    render(<RemovalTemplateReviewPanel facilityId={FACILITY_ID} canManage />);

    expect(screen.getByText("Template no longer exists in Isometric.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Save/ })).toBeNull();
  });
});
