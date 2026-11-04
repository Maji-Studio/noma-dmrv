// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SETUP_NOT_LINKED_MESSAGE } from "@/lib/certification/removal-template-blockers";
import { RemovalTemplateSummaryCard } from "./removal-template-summary-card";
import { addedComponent, component, dieselSource, setupData, startupDefault, template } from "./removal-template-setup/test-support";

const FACILITY = "11111111-1111-4111-8111-111111111111";
const state = vi.hoisted(() => ({ data: undefined as unknown, batches: [] as unknown[], error: null as Error | null }));
vi.mock("@/hooks/use-removal-template-setup", () => ({
  useRemovalTemplateSetup: () => ({ data: state.error ? undefined : state.data, error: state.error, isError: !!state.error, isFetching: false, refetch: vi.fn() }),
}));
vi.mock("./removal-template-setup/removal-template-setup-dialog", () => ({
  RemovalTemplateSetupDialog: ({ isOpen, step, templateId, onClose }: { isOpen: boolean; step?: string | null; templateId?: string | null; onClose: () => void }) => (
    isOpen ? <div role="dialog">{`setup ${step} ${templateId ?? "no template"}`}<button onClick={onClose}>Close setup</button></div> : null
  ),
}));
vi.mock("@/hooks/use-credit-batches", () => ({ useCreditBatches: () => ({ data: state.batches }) }));

afterEach(() => { cleanup(); onUrlUpdate.mockClear(); });

const ready = template("tpl-ready", "Protocol default", { defaults: [startupDefault] });
const open = template("tpl-open", "Protocol default", { decisions: [dieselSource], defaults: [startupDefault] });

const onUrlUpdate = vi.fn();

function show(overrides: Parameters<typeof setupData>[0], batches: unknown[] = [], params = "") {
  state.data = setupData(overrides);
  state.batches = batches;
  state.error = null;
  render(
    <NuqsTestingAdapter hasMemory searchParams={params} onUrlUpdate={onUrlUpdate}>
      <RemovalTemplateSummaryCard facilityId={FACILITY} />
    </NuqsTestingAdapter>,
  );
}

describe("RemovalTemplateSummaryCard", () => {
  it("shows Ready with Change template for an Admin", () => {
    show({ fitting: [ready], removalTemplateId: "tpl-ready" }, [{ id: "b1", code: "CB-26-001", removalTemplateId: "tpl-ready" }]);
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.getByRole("link", { name: "CB-26-001" }).getAttribute("href")).toContain("/credit-batches/b1");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Review decisions" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Change template" }));
    expect(screen.getByRole("dialog").textContent).toContain("setup template no template");
  });

  it("Change template opens the dialog on the template list with nothing picked", () => {
    show({ fitting: [ready], removalTemplateId: "tpl-ready" });
    fireEvent.click(screen.getByRole("button", { name: "Change template" }));
    expect(screen.getByRole("dialog").textContent).toContain("setup template no template");
  });

  it("opens the dialog from a setup link for an Admin and clears the params on close", async () => {
    show({ fitting: [ready], removalTemplateId: "tpl-ready" }, [], "?facility=facility-1&setup=check&template=tpl-ready");
    expect(screen.getByRole("dialog").textContent).toContain("setup check tpl-ready");
    fireEvent.click(screen.getByRole("button", { name: "Close setup" }));
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    const { searchParams, options } = onUrlUpdate.mock.lastCall![0];
    expect(options.history).toBe("replace");
    expect(searchParams.get("setup")).toBeNull();
    expect(searchParams.get("template")).toBeNull();
    expect(searchParams.get("facility")).toBe("facility-1");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not open the dialog for a Member with a setup link", () => {
    show({ fitting: [ready], removalTemplateId: "tpl-ready", viewerCanManage: false }, [], "?setup=decisions&template=tpl-ready");
    expect(screen.getByRole("heading", { name: "Protocol default" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the same card to a Member without buttons or raw ids", () => {
    show({ fitting: [ready], removalTemplateId: "tpl-ready", viewerCanManage: false });
    expect(screen.getByRole("heading", { name: "Protocol default" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Review decisions" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Change template" })).toBeNull();
    expect(screen.queryByText("tpl-ready")).toBeNull();
  });

  it("says how many components are still to decide", () => {
    show({ fitting: [open], removalTemplateId: "tpl-open", currentToDecideCount: 1 });
    expect(screen.getByText("1 component to decide")).toBeTruthy();
    expect(screen.queryByText("Ready")).toBeNull();
  });

  it("offers Set template when no template is set, to Admins only", () => {
    show({ fitting: [ready] });
    expect(screen.getByText("No Removal template set")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Set template" }));
    expect(screen.getByRole("dialog").textContent).toContain("setup template no template");
    cleanup();
    show({ fitting: [ready], viewerCanManage: false });
    expect(screen.queryByRole("button", { name: "Set template" })).toBeNull();
  });

  it("reads a template that is blocked or unfit as a problem with its reason, never as Ready", () => {
    const blocked = template("tpl-blocked", "Fixed values missing", { defaults: [startupDefault] }, "Set each value in the Isometric template editor before submitting.");
    show({ fitting: [blocked], removalTemplateId: "tpl-blocked" });
    expect(screen.getByText("Not ready")).toBeTruthy();
    expect(screen.queryByText("Ready")).toBeNull();
    expect(screen.getByText(/Isometric has fixed values without a datapoint/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Review decisions" })).toBeNull();
    cleanup();
    show({ fitting: [], notFitting: [{ id: "tpl-x", name: "Old template", reason: "This template has no storage component." }], removalTemplateId: "tpl-x" });
    expect(screen.getByText("Does not fit")).toBeTruthy();
    expect(screen.getByText(/This template has no storage component\. Choose another template\./)).toBeTruthy();
  });

  it("does not tell a Member to act on a problem", () => {
    const blocked = template("tpl-blocked", "Fixed values missing", { defaults: [startupDefault] }, "Set each value in the Isometric template editor before submitting.");
    show({ fitting: [blocked], removalTemplateId: "tpl-blocked", viewerCanManage: false });
    expect(screen.queryByText(/Set them in the Isometric template editor/)).toBeNull();
    expect(screen.getByText("Isometric has fixed values without a datapoint in this template.")).toBeTruthy();
  });

  it("says a template missing from Isometric is missing, not unset", () => {
    show({ fitting: [ready], removalTemplateId: "tpl-gone" });
    expect(screen.queryByText("No Removal template set")).toBeNull();
    expect(screen.getByText("Not found")).toBeTruthy();
    expect(screen.getByText(/no longer in this Isometric project/)).toBeTruthy();
  });

  it("counts components decided and an added component as to decide", () => {
    const added = template("tpl-added", "Changed template", { decided: [component("a", "A")], decisions: [addedComponent] });
    show({ fitting: [added], removalTemplateId: "tpl-added", currentToDecideCount: 1 });
    expect(screen.getByText("1 component to decide")).toBeTruthy();
    expect(screen.getByText("1 of 2 decided")).toBeTruthy();
    expect(screen.queryByText("Decided by you")).toBeNull();
  });

  it("sends an unlinked facility to Settings, Facilities", () => {
    state.error = new Error(SETUP_NOT_LINKED_MESSAGE);
    render(<NuqsTestingAdapter><RemovalTemplateSummaryCard facilityId={FACILITY} /></NuqsTestingAdapter>);
    expect(screen.getByRole("link", { name: "Open Settings, Facilities" }).getAttribute("href")).toContain("/settings/facilities");
  });
});
