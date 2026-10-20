// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SETUP_NOT_LINKED_MESSAGE } from "@/lib/certification/removal-template-blockers";
import { RemovalTemplateSummaryCard } from "./removal-template-summary-card";
import { addedComponent, component, dieselSource, setupData, startupDefault, template } from "./removal-template-setup/test-support";

const FACILITY = "11111111-1111-4111-8111-111111111111";
const state = vi.hoisted(() => ({ data: undefined as unknown, batches: [] as unknown[], error: null as Error | null }));
vi.mock("@/hooks/use-removal-template-setup", () => ({
  useRemovalTemplateSetup: () => ({ data: state.error ? undefined : state.data, error: state.error, isError: !!state.error, isFetching: false, refetch: vi.fn() }),
}));
vi.mock("@/hooks/use-credit-batches", () => ({ useCreditBatches: () => ({ data: state.batches }) }));

afterEach(cleanup);

const ready = template("tpl-ready", "Protocol default", { defaults: [startupDefault] });
const open = template("tpl-open", "Protocol default", { decisions: [dieselSource], defaults: [startupDefault] });

function show(overrides: Parameters<typeof setupData>[0], batches: unknown[] = []) {
  state.data = setupData(overrides);
  state.batches = batches;
  state.error = null;
  render(<RemovalTemplateSummaryCard facilityId={FACILITY} />);
}

describe("RemovalTemplateSummaryCard", () => {
  it("shows Ready with both buttons for an Owner or Admin", () => {
    show({ fitting: [ready], defaultRemovalTemplateId: "tpl-ready" }, [{ id: "b1", code: "CB-26-001", removalTemplateId: "tpl-ready" }]);
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.getByRole("link", { name: "CB-26-001" }).getAttribute("href")).toContain("/credit-batches/b1");
    expect(screen.getByRole("link", { name: "Review decisions" }).getAttribute("href")).toContain("step=decisions");
    expect(screen.getByRole("link", { name: "Change template" }).getAttribute("href")).toContain("step=template");
    expect(screen.getByRole("link", { name: "Change template" }).getAttribute("href")).not.toContain("template=tpl-ready");
  });

  it("shows the same card to a Member without buttons or raw ids", () => {
    show({ fitting: [ready], defaultRemovalTemplateId: "tpl-ready", viewerCanManage: false });
    expect(screen.getByRole("heading", { name: "Protocol default" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Review decisions" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Change template" })).toBeNull();
    expect(screen.queryByText("tpl-ready")).toBeNull();
  });

  it("says how many components are still to decide", () => {
    show({ fitting: [open], defaultRemovalTemplateId: "tpl-open", defaultToDecideCount: 1 });
    expect(screen.getByText("1 component to decide")).toBeTruthy();
    expect(screen.queryByText("Ready")).toBeNull();
  });

  it("offers Set up template when there is no default, to Owners and Admins only", () => {
    show({ fitting: [ready] });
    expect(screen.getByText("No Removal template set")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Set up template" }).getAttribute("href")).toContain("/certification/settings/removal-template-setup");
    cleanup();
    show({ fitting: [ready], viewerCanManage: false });
    expect(screen.queryByRole("link", { name: "Set up template" })).toBeNull();
  });

  it("reads a default that is blocked or unfit as a problem with its reason, never as Ready", () => {
    const blocked = template("tpl-blocked", "Fixed values missing", { defaults: [startupDefault] }, "Set each value in the Isometric template editor before submitting.");
    show({ fitting: [blocked], defaultRemovalTemplateId: "tpl-blocked" });
    expect(screen.getByText("Not ready")).toBeTruthy();
    expect(screen.queryByText("Ready")).toBeNull();
    expect(screen.getByText(/Isometric has fixed values without a datapoint/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Review decisions" })).toBeNull();
    cleanup();
    show({ fitting: [], notFitting: [{ id: "tpl-x", name: "Old template", reason: "This template has no storage component." }], defaultRemovalTemplateId: "tpl-x" });
    expect(screen.getByText("Does not fit")).toBeTruthy();
    expect(screen.getByText(/This template has no storage component\. Choose another template\./)).toBeTruthy();
  });

  it("does not tell a Member to act on a problem", () => {
    const blocked = template("tpl-blocked", "Fixed values missing", { defaults: [startupDefault] }, "Set each value in the Isometric template editor before submitting.");
    show({ fitting: [blocked], defaultRemovalTemplateId: "tpl-blocked", viewerCanManage: false });
    expect(screen.queryByText(/Set them in the Isometric template editor/)).toBeNull();
    expect(screen.getByText("Isometric has fixed values without a datapoint in this template.")).toBeTruthy();
  });

  it("says a default missing from Isometric is missing, not unset", () => {
    show({ fitting: [ready], defaultRemovalTemplateId: "tpl-gone" });
    expect(screen.queryByText("No Removal template set")).toBeNull();
    expect(screen.getByText("Not found")).toBeTruthy();
    expect(screen.getByText(/no longer in this Isometric project/)).toBeTruthy();
  });

  it("counts components decided and an added component as to decide", () => {
    const added = template("tpl-added", "Changed template", { decided: [component("a", "A")], decisions: [addedComponent] });
    show({ fitting: [added], defaultRemovalTemplateId: "tpl-added", defaultToDecideCount: 1 });
    expect(screen.getByText("1 component to decide")).toBeTruthy();
    expect(screen.getByText("1 of 2 decided")).toBeTruthy();
    expect(screen.queryByText("Decided by you")).toBeNull();
  });

  it("sends an unlinked facility to Certifier", () => {
    state.error = new Error(SETUP_NOT_LINKED_MESSAGE);
    render(<RemovalTemplateSummaryCard facilityId={FACILITY} />);
    expect(screen.getByRole("link", { name: "Open Certifier" })).toBeTruthy();
  });
});
