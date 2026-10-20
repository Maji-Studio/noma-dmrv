// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RemovalTemplateSummaryCard } from "./removal-template-summary-card";
import { dieselSource, setupData, startupDefault, template } from "./removal-template-setup/test-support";

const FACILITY = "11111111-1111-4111-8111-111111111111";
const state = vi.hoisted(() => ({ data: undefined as unknown, batches: [] as unknown[] }));
vi.mock("@/hooks/use-removal-template-setup", () => ({
  useRemovalTemplateSetup: () => ({ data: state.data, isError: false, isFetching: false, refetch: vi.fn() }),
}));
vi.mock("@/hooks/use-credit-batches", () => ({ useCreditBatches: () => ({ data: state.batches }) }));

afterEach(cleanup);

const ready = template("tpl-ready", "Protocol default", { defaults: [startupDefault] });
const open = template("tpl-open", "Protocol default", { decisions: [dieselSource], defaults: [startupDefault] });

function show(overrides: Parameters<typeof setupData>[0], batches: unknown[] = []) {
  state.data = setupData(overrides);
  state.batches = batches;
  render(<RemovalTemplateSummaryCard facilityId={FACILITY} />);
}

describe("RemovalTemplateSummaryCard", () => {
  it("shows Ready with both buttons for an Owner or Admin", () => {
    show({ fitting: [ready], defaultRemovalTemplateId: "tpl-ready" }, [{ id: "b1", code: "CB-26-001", removalTemplateId: "tpl-ready" }]);
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.getByRole("link", { name: "CB-26-001" }).getAttribute("href")).toContain("/credit-batches/b1");
    expect(screen.getByRole("link", { name: "Review decisions" }).getAttribute("href")).toContain("step=decisions");
    expect(screen.getByRole("link", { name: "Change template" }).getAttribute("href")).toContain("step=template");
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
    expect(screen.getByText("1 to decide")).toBeTruthy();
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
});
