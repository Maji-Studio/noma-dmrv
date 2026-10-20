// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FormDialogContext } from "@/components/ui/form-dialog-context";
import { StaleVersionError, STALE_VERSION_CONFLICT_CODE, STALE_VERSION_MESSAGE } from "@/lib/stale-version";
import { RemovalTemplateReviewPanel } from "./removal-template-review-panel";
import { component, entry, OBSERVATION_ID } from "./removal-template-review-test-support";

vi.mock("@/components/ui/tooltip", () => ({
  InfoHint: () => null,
  Tooltip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn() }) }));

const mocks = vi.hoisted(() => ({
  data: [] as unknown[],
  previewEntry: undefined as unknown,
  previewEnabled: [] as boolean[],
  previewRefetch: vi.fn(),
  refetch: vi.fn(),
  mutateAsync: vi.fn(),
  setupMutate: vi.fn(),
}));
vi.mock("@/hooks/use-removal-template-review", () => ({
  useRemovalTemplateReview: () => ({
    data: mocks.data, isLoading: false, isError: false, isFetching: false, refetch: mocks.refetch,
  }),
  useRemovalTemplateReviewEntry: (_facility: string, _template: string, enabled: boolean) => {
    mocks.previewEnabled.push(enabled);
    return {
      data: mocks.previewEntry, isPending: enabled && !mocks.previewEntry,
      isError: false, isFetching: false, refetch: mocks.previewRefetch,
    };
  },
  useReviewRemovalTemplateLines: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
  useSetFacilityDefaultRemovalTemplate: () => ({ mutateAsync: mocks.setupMutate, isPending: false }),
  useStartRemovalTemplateSetup: () => ({ mutateAsync: mocks.setupMutate, isPending: false }),
}));

const FACILITY_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.data = [entry()];
  mocks.previewEntry = undefined;
  mocks.previewEnabled = [];
  mocks.mutateAsync.mockResolvedValue({});
});
afterEach(cleanup);

const saveButton = () => screen.getByRole("button", { name: /^Save/ });

describe("RemovalTemplateReviewPanel", () => {
  it("shows a requested template the facility has not observed, first and read-only", () => {
    mocks.previewEntry = entry({
      templateId: "rvt_new", template: { id: "rvt_new", display_name: "Unused Template", credit_type: "REMOVAL" },
      observation: null, preview: true, isDefault: false,
    });
    render(<RemovalTemplateReviewPanel facilityId={FACILITY_ID} canManage templateId="rvt_new" />);

    const names = screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);
    expect(names).toEqual(["Unused Template", "Dark Earth Carbon Template"]);
    expect(screen.getByText("Not set up yet")).toBeTruthy();
    // The one preview has nothing to save against; the listed card keeps its own controls.
    expect(screen.getAllByRole("button", { name: /^Save/ })).toHaveLength(1);
  });

  it("drops a cached preview once the template is listed, so the card shows once", () => {
    mocks.previewEntry = entry({ observation: null, preview: true });
    const { rerender } = render(<RemovalTemplateReviewPanel facilityId={FACILITY_ID} canManage templateId="rvt_test" />);
    rerender(<RemovalTemplateReviewPanel facilityId={FACILITY_ID} canManage templateId="rvt_test" />);
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(1);
  });

  it("retries a previewed template through its own read", () => {
    mocks.data = [];
    mocks.previewEntry = entry({
      templateId: "rvt_new", observation: null, preview: true, isDefault: false, enrichment: {},
      enrichmentProblems: [{ code: "unknown-enrichment", componentId: "cmp_startup", inputKey: "volume_of_fuel" }],
    });
    render(<RemovalTemplateReviewPanel facilityId={FACILITY_ID} canManage templateId="rvt_new" />);
    mocks.refetch.mockClear();
    mocks.previewRefetch.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.previewRefetch).toHaveBeenCalledTimes(1);
    expect(mocks.refetch).not.toHaveBeenCalled();
  });

  it("does not read a requested template the facility already lists", () => {
    render(<RemovalTemplateReviewPanel facilityId={FACILITY_ID} canManage templateId="rvt_test" />);

    expect(mocks.previewEnabled.every((enabled) => !enabled)).toBe(true);
    expect(screen.queryByText("Not set up yet")).toBeNull();
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(1);
  });

  it("shows a requested template even when the facility lists none", () => {
    mocks.data = [];
    mocks.previewEntry = entry({
      templateId: "rvt_new", template: { id: "rvt_new", display_name: "Unused Template", credit_type: "REMOVAL" },
      observation: null, preview: true, isDefault: false,
    });
    render(<RemovalTemplateReviewPanel facilityId={FACILITY_ID} canManage={false} templateId="rvt_new" />);

    expect(screen.getByText("Unused Template")).toBeTruthy();
    expect(screen.queryByText("No Removal templates yet")).toBeNull();
  });

  it("is read-only for members and still flags the component to decide", () => {
    render(<RemovalTemplateReviewPanel facilityId={FACILITY_ID} canManage={false} />);

    expect(screen.getByText("Dark Earth Carbon Template")).toBeTruthy();
    expect(screen.getByText("Default")).toBeTruthy();
    expect(screen.getByText("To decide")).toBeTruthy();
    expect(screen.getByText("Ask an Owner or Admin to decide the components marked To decide.")).toBeTruthy();
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

  it("does not offer a proposal that another line's figure would refuse (#1198)", async () => {
    const lastMile = {
      ...entry().lines[0],
      component: component("cmp_last_mile", "Last mile startup diesel"),
    };
    mocks.data = [entry({
      lines: [...entry().lines, lastMile],
      lineSourceProblems: [
        { code: "ambiguous", componentId: "cmp_startup" }, { code: "ambiguous", componentId: "cmp_last_mile" },
      ],
    })];
    render(<RemovalTemplateReviewPanel facilityId={FACILITY_ID} canManage />);

    expect(screen.queryByRole("button", { name: /Accept proposal/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Change Startup diesel usage" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change Last mile startup diesel" })).toBeTruthy();
  });

  it("stops offering a proposal once another unsaved line takes its figure", async () => {
    const generator = {
      ...entry().lines[0],
      component: component("cmp_genset", "Generator diesel usage"),
      contract: { scope: "unassigned", entryPolicy: "none", origin: "proposed" },
    };
    mocks.data = [entry({ lines: [...entry().lines, generator] })];
    render(<RemovalTemplateReviewPanel facilityId={FACILITY_ID} canManage />);
    expect(screen.getByRole("button", { name: "Accept proposal for Startup diesel usage" })).toBeTruthy();

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Change Generator diesel usage" })); });
    await act(async () => {
      fireEvent.change(document.getElementById("rvt_test-cmp_genset-scope")!, { target: { value: "operating" } });
    });
    await act(async () => {
      fireEvent.change(document.getElementById("rvt_test-cmp_genset-source")!, { target: { value: "run-startup-diesel" } });
    });

    expect(screen.queryByRole("button", { name: "Accept proposal for Startup diesel usage" })).toBeNull();
  });

  it("assigns a contract through the line controls", async () => {
    render(<RemovalTemplateReviewPanel facilityId={FACILITY_ID} canManage />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Change Startup diesel usage" })); });
    const scope = document.getElementById("rvt_test-cmp_startup-scope") as HTMLSelectElement;
    await act(async () => { fireEvent.change(scope, { target: { value: "forbidden" } }); });
    // Only operating components take entries, so the policy resets with the scope.
    expect((document.getElementById("rvt_test-cmp_startup-entries") as HTMLSelectElement).disabled).toBe(true);

    await act(async () => { fireEvent.click(saveButton()); });
    expect(mocks.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      assignments: { cmp_startup: { scope: "forbidden", entryPolicy: "none" } },
    }));
  });

  it("offers assignment only on components to decide", () => {
    mocks.data = [entry({
      lineSourceProblems: [{ code: "ambiguous", componentId: "cmp_lab" }],
      lines: [
        ...entry().lines,
        {
          component: component("cmp_genset", "Generator diesel usage"), groupKey: "pyrolysis", groupName: "Operations",
          contract: { scope: "operating", automaticSource: "run-genset-diesel", entryPolicy: "additive", origin: "reviewed" },
          catalogCandidates: ["run-genset-diesel"], allowedEntryPolicies: ["none", "additive"], change: "unchanged",
        },
      ],
    })];
    render(<RemovalTemplateReviewPanel facilityId={FACILITY_ID} canManage />);

    // Proposed, and settled but with a line source problem.
    expect(screen.getByRole("button", { name: "Change Startup diesel usage" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change Lab electricity" })).toBeTruthy();
    // Settled and reviewed: read-only.
    expect(screen.queryByRole("button", { name: "Change Generator diesel usage" })).toBeNull();
  });

  it("shows each input's quantity kind and unit", () => {
    render(<RemovalTemplateReviewPanel facilityId={FACILITY_ID} canManage />);
    const startup = screen.getByText("Startup diesel usage").closest("li")!;
    const lab = screen.getByText("Lab electricity").closest("li")!;

    expect([...startup.querySelectorAll("th")].map((cell) => cell.textContent)).toEqual(["Input", "Measures", "Unit"]);
    expect([...startup.querySelectorAll("tbody td")].map((cell) => cell.textContent)).toEqual(["volume_of_fuel", "Volume", "L"]);
    expect([...lab.querySelectorAll("tbody td")].map((cell) => cell.textContent)).toEqual(["volume_of_fuel", "Volume", "Not available"]);
  });

  it("disables saving and offers a retry while the template is not fully read", async () => {
    mocks.data = [entry({
      enrichmentProblems: [{ code: "unknown-enrichment", componentId: "cmp_startup", inputKey: "volume_of_fuel" }],
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

  it("keeps the draft on its loaded version until an explicit reload", async () => {
    mocks.mutateAsync.mockRejectedValueOnce(new StaleVersionError(STALE_VERSION_MESSAGE, {
      entity: "removal_template_observation", id: OBSERVATION_ID, code: STALE_VERSION_CONFLICT_CODE,
    }));
    const { rerender } = render(<RemovalTemplateReviewPanel facilityId={FACILITY_ID} canManage />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Accept proposal for Startup diesel usage" }));
    });

    // A refetch lands under the draft: the save still checks the version the draft was made on.
    mocks.data = [entry({ observation: { id: OBSERVATION_ID, version: 4, enrichment: {} } })];
    rerender(<RemovalTemplateReviewPanel facilityId={FACILITY_ID} canManage />);
    await act(async () => { fireEvent.click(saveButton()); });
    expect(mocks.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 3 }));

    expect(screen.getByText(STALE_VERSION_MESSAGE)).toBeTruthy();
    expect(screen.getByText("Not saved")).toBeTruthy();
    expect(mocks.refetch).not.toHaveBeenCalled();
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Discard changes and reload" })); });
    expect(mocks.refetch).toHaveBeenCalled();
    expect(screen.queryByText("Not saved")).toBeNull();
    expect(screen.queryByText(STALE_VERSION_MESSAGE)).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Accept proposal for Startup diesel usage" }));
    });
    await act(async () => { fireEvent.click(saveButton()); });
    expect(mocks.mutateAsync).toHaveBeenLastCalledWith(expect.objectContaining({ expectedVersion: 4 }));
  });

  it("reports a draft as unsaved changes to the surrounding guard until it is undone", async () => {
    const report = vi.fn();
    const guard = { report, cancel: vi.fn(), markSaved: vi.fn() };
    render(
      <FormDialogContext.Provider value={guard}>
        <RemovalTemplateReviewPanel facilityId={FACILITY_ID} canManage />
      </FormDialogContext.Provider>,
    );
    expect(report).toHaveBeenLastCalledWith(expect.anything(), { dirty: false, busy: false });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Accept proposal for Startup diesel usage" }));
    });
    expect(report).toHaveBeenLastCalledWith(expect.anything(), { dirty: true, busy: false });

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Undo changes to Startup diesel usage" })); });
    expect(report).toHaveBeenLastCalledWith(expect.anything(), { dirty: false, busy: false });
  });

  it("is clean again after a successful save", async () => {
    const report = vi.fn();
    render(
      <FormDialogContext.Provider value={{ report, cancel: vi.fn(), markSaved: vi.fn() }}>
        <RemovalTemplateReviewPanel facilityId={FACILITY_ID} canManage />
      </FormDialogContext.Provider>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Accept proposal for Startup diesel usage" }));
    });
    await act(async () => { fireEvent.click(saveButton()); });

    expect(mocks.mutateAsync).toHaveBeenCalled();
    expect(screen.queryByText("Not saved")).toBeNull();
    expect(report).toHaveBeenLastCalledWith(expect.anything(), { dirty: false, busy: false });
  });

  it("shows a missing template with no lines to review", () => {
    mocks.data = [entry({ template: null, observation: null, availability: "missing", lines: [], lineSourceProblems: [] })];
    render(<RemovalTemplateReviewPanel facilityId={FACILITY_ID} canManage />);

    expect(screen.getByText("Template no longer exists in Isometric.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Save/ })).toBeNull();
  });

  it("lays lines out like Isometric: Mitigated then Emitted, groups with counts", () => {
    const base = entry();
    mocks.data = [entry({ lines: [
      ...base.lines,
      { ...base.lines[1], component: component("cmp_stored", "CO₂ stored from biochar application"),
        groupKey: "co2-stored", groupName: "CO₂ stored", section: "mitigated", groupPosition: 8 },
    ] })];
    render(<RemovalTemplateReviewPanel facilityId={FACILITY_ID} canManage />);
    const headings = screen.getAllByRole("heading").map((heading) => heading.textContent);
    expect(headings).toEqual([
      "Dark Earth Carbon Template", "Mitigated (1)", "CO₂ stored (1)", "Emitted (2)", "Operations (2)",
    ]);
  });

  it("makes another template the default and starts deciding a template not set up yet", async () => {
    mocks.setupMutate.mockResolvedValue(undefined);
    mocks.data = [entry({ isDefault: false, observation: null, preview: true })];
    render(<RemovalTemplateReviewPanel facilityId={FACILITY_ID} canManage templateId="rvt_test" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Make default" }));
    });
    expect(mocks.setupMutate).toHaveBeenCalledWith({ facilityId: FACILITY_ID, removalTemplateId: "rvt_test" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Decide components" }));
    });
    expect(mocks.setupMutate).toHaveBeenCalledTimes(2);
  });

  it("keeps a template that is not the default or linked folded until opened", () => {
    mocks.data = [entry({ isDefault: false })];
    render(<RemovalTemplateReviewPanel facilityId={FACILITY_ID} canManage />);
    const toggle = screen.getByRole("button", { name: "Show components" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Hide components" }).getAttribute("aria-expanded")).toBe("true");
  });
});
