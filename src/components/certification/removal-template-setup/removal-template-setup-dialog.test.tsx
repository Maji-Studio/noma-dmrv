// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RemovalTemplateSetupDialog } from "./removal-template-setup-dialog";
import { setupData } from "./test-support";

const ACTIVE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const state = vi.hoisted(() => ({ read: [] as { facilityId: string; enabled: boolean }[], error: false, loading: false, refetch: undefined as unknown as ReturnType<typeof vi.fn> }));

vi.mock("@/hooks/use-removal-template-setup", () => ({
  useRemovalTemplateSetup: (facilityId: string, enabled: boolean) => {
    state.read.push({ facilityId, enabled });
    return { data: state.error || state.loading ? undefined : setupData(), isError: state.error, isFetching: false, refetch: state.refetch };
  },
}));
vi.mock("./setup-flow", () => ({
  RemovalTemplateSetupFlow: ({ facilityId, templateId, step, makeDefault }: { facilityId: string; templateId: string | null; step: string | null; makeDefault: boolean }) => (
    <div>{`flow for ${facilityId} ${templateId ?? "no template"} ${step ?? "no step"} ${makeDefault ? "default" : "no default"}`}</div>
  ),
}));

afterEach(() => { cleanup(); state.read.length = 0; state.error = false; state.loading = false; });

describe("RemovalTemplateSetupDialog", () => {
  it("reads and writes the facility it is given and hands the link's start to the flow", () => {
    state.refetch = vi.fn();
    render(<RemovalTemplateSetupDialog isOpen facilityId={ACTIVE} templateId="tpl" step="decisions" makeDefault={false} onClose={vi.fn()} />);
    expect(new Set(state.read.map((read) => read.facilityId))).toEqual(new Set([ACTIVE]));
    expect(screen.getByRole("dialog", { name: "Set up Removal template" })).toBeTruthy();
    expect(screen.getByText(`flow for ${ACTIVE} tpl decisions no default`)).toBeTruthy();
    expect(screen.getByText("Mafinga Facility")).toBeTruthy();
  });

  it("ignores a step it does not know and reads nothing while closed", () => {
    state.refetch = vi.fn();
    render(<RemovalTemplateSetupDialog isOpen={false} facilityId={ACTIVE} step="bogus" onClose={vi.fn()} />);
    expect(state.read).toEqual([]);
    cleanup();
    render(<RemovalTemplateSetupDialog isOpen facilityId={ACTIVE} step="bogus" onClose={vi.fn()} />);
    expect(screen.getByText(`flow for ${ACTIVE} no template no step default`)).toBeTruthy();
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
});
