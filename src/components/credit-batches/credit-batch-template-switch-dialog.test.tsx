// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EntitySelectProps } from "@/components/forms/entity-select/types";
import type { IsometricGhgEntryTemplate } from "@/lib/isometric";
import { CreditBatchTemplateSwitchDialog } from "./credit-batch-template-switch-dialog";

vi.mock("@/components/ui/tooltip", () => ({
  InfoHint: () => null,
  Tooltip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/forms/entity-select/entity-select", () => ({
  EntitySelect: ({ id, value, options, onChange, disabled }: EntitySelectProps) => (
    <select id={id} value={value ?? ""} disabled={disabled} onChange={(event) => onChange(event.target.value || undefined)}>
      <option value="">Select a template</option>
      {options?.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
    </select>
  ),
}));
const mocks = vi.hoisted(() => ({ mutateAsync: vi.fn(), success: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: mocks.success }) }));
vi.mock("@/hooks/use-removal-template-review", () => ({
  useSwitchCreditBatchRemovalTemplate: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
}));

const BATCH = { id: "33333333-3333-4333-8333-333333333333", code: "CB-26-001", version: 4, removalTemplateId: "rvt_old" };
const TEMPLATES = [
  { id: "rvt_old", display_name: "Removal Template 2026-07-03", credit_type: "REMOVAL" },
  { id: "rvt_new", display_name: "Dark Earth Carbon Template", credit_type: "REMOVAL" },
  { id: "rdt_reduction", display_name: "Reduction template", credit_type: "REDUCTION" },
] as IsometricGhgEntryTemplate[];

const onClose = vi.fn();
beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn().mockImplementation(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.clearAllMocks();
  mocks.mutateAsync.mockResolvedValue({ ...BATCH, removalTemplateId: "rvt_new", version: 5 });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount() {
  render(
    <CreditBatchTemplateSwitchDialog
      isOpen
      onClose={onClose}
      creditBatch={BATCH}
      defaultTemplateId="rvt_new"
      templates={TEMPLATES}
      templatesLoading={false}
      templatesError={null}
    />,
  );
}

describe("CreditBatchTemplateSwitchDialog", () => {
  it("lists only Removal templates and waits for a different choice", async () => {
    mount();
    await screen.findByRole("dialog", { name: "Switch template" });
    const select = document.getElementById("removalTemplateId") as HTMLSelectElement;
    expect([...select.options].map((option) => option.text)).toEqual([
      "Select a template", "Removal Template 2026-07-03", "Dark Earth Carbon Template",
    ]);
    expect((screen.getByRole("button", { name: "Switch template" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("switches the pin against the batch version and closes", async () => {
    mount();
    await screen.findByRole("dialog", { name: "Switch template" });
    await act(async () => {
      fireEvent.change(document.getElementById("removalTemplateId")!, { target: { value: "rvt_new" } });
    });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Switch template" })); });

    expect(mocks.mutateAsync).toHaveBeenCalledWith({
      creditBatchId: BATCH.id, removalTemplateId: "rvt_new", expectedVersion: 4,
    });
    expect(mocks.success).toHaveBeenCalledWith("Removal template switched for CB-26-001.");
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps the dialog open with the server refusal", async () => {
    mocks.mutateAsync.mockRejectedValue(new Error("This credit batch backs a submitted Removal."));
    mount();
    await screen.findByRole("dialog", { name: "Switch template" });
    await act(async () => {
      fireEvent.change(document.getElementById("removalTemplateId")!, { target: { value: "rvt_new" } });
    });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Switch template" })); });

    expect(screen.getByText("This credit batch backs a submitted Removal.")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});
