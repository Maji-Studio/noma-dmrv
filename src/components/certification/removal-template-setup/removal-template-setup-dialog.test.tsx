// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RemovalTemplateSetupDialog } from "./removal-template-setup-dialog";
import { setupData } from "./test-support";

const ACTIVE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const state = vi.hoisted(() => ({ pending: false, read: [] as { facilityId: string; enabled: boolean }[], error: false, loading: false, defaultId: null as string | null, refetch: undefined as unknown as ReturnType<typeof vi.fn> }));

vi.mock("@/hooks/use-removal-template-setup", () => ({
  useApplyRemovalTemplateSetup: () => ({ isPending: state.pending, reset: vi.fn(), mutateAsync: vi.fn() }),
  useRemovalTemplateSetup: (facilityId: string, enabled: boolean) => {
    state.read.push({ facilityId, enabled });
    return { data: state.error || state.loading ? undefined : setupData({ removalTemplateId: state.defaultId }), isError: state.error, isFetching: false, refetch: state.refetch };
  },
}));
vi.mock("./setup-flow", () => ({
  RemovalTemplateSetupFlow: ({ facilityId, templateId, step }: { facilityId: string; templateId: string | null; step: string | null }) => (
    <div>{`flow for ${facilityId} ${templateId ?? "no template"} ${step ?? "no step"}`}</div>
  ),
}));

afterEach(() => { cleanup(); state.read.length = 0; state.error = false; state.loading = false; state.defaultId = null; state.pending = false; });

describe("RemovalTemplateSetupDialog", () => {
  it("reads and writes the facility it is given and hands the link's start to the flow", () => {
    state.refetch = vi.fn();
    render(<RemovalTemplateSetupDialog isOpen facilityId={ACTIVE} templateId="tpl" step="check" onClose={vi.fn()} />);
    expect(new Set(state.read.map((read) => read.facilityId))).toEqual(new Set([ACTIVE]));
    expect(screen.getByText(`flow for ${ACTIVE} tpl check`)).toBeTruthy();
  });

  it("is always titled Set Removal template, with no facility subtitle, while loading, failing or loaded", () => {
    state.refetch = vi.fn();
    const titleNow = () => {
      render(<RemovalTemplateSetupDialog isOpen facilityId={ACTIVE} step="template" onClose={vi.fn()} />);
      const text = screen.getByRole("dialog", { name: "Set Removal template" }).textContent;
      cleanup();
      return text;
    };
    expect(titleNow()).not.toContain("Mafinga Facility");
    state.defaultId = "tpl";
    expect(titleNow()).toContain("Set Removal template");
    state.loading = true;
    expect(titleNow()).toContain("Set Removal template");
    state.loading = false;
    state.error = true;
    expect(titleNow()).toContain("Set Removal template");
  });

  it("ignores a step it does not know and reads nothing while closed", () => {
    state.refetch = vi.fn();
    render(<RemovalTemplateSetupDialog isOpen={false} facilityId={ACTIVE} step="bogus" onClose={vi.fn()} />);
    expect(state.read).toEqual([]);
    cleanup();
    render(<RemovalTemplateSetupDialog isOpen facilityId={ACTIVE} step="bogus" onClose={vi.fn()} />);
    expect(screen.getByText(`flow for ${ACTIVE} no template no step`)).toBeTruthy();
  });

  it("shows a skeleton while loading", () => {
    state.refetch = vi.fn();
    state.loading = true;
    render(<RemovalTemplateSetupDialog isOpen facilityId={ACTIVE} onClose={vi.fn()} />);
    expect(screen.getByLabelText("Loading Removal templates")).toBeTruthy();
  });

  it("offers Try again and Cancel when the templates cannot be read", () => {
    state.refetch = vi.fn();
    state.error = true;
    const onClose = vi.fn();
    render(<RemovalTemplateSetupDialog isOpen facilityId={ACTIVE} onClose={onClose} />);
    expect(screen.getByText("The Removal templates could not be read from Isometric.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(state.refetch).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("cannot be dismissed while Set template is pending, so a refusal and its Reload are never lost", () => {
    state.refetch = vi.fn();
    state.pending = true;
    const onClose = vi.fn();
    render(<RemovalTemplateSetupDialog isOpen facilityId={ACTIVE} onClose={onClose} />);
    expect((screen.getByRole("button", { name: "Close" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
