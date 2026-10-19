// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EntitySelectProps } from "@/components/forms/entity-select/types";
import type { IsometricGhgEntryTemplate } from "@/lib/isometric";
import { StaleVersionError, STALE_VERSION_CONFLICT_CODE, STALE_VERSION_MESSAGE } from "@/lib/stale-version";
import { CreditBatchTemplateSwitchDialog, type CreditBatchTemplateSwitchDialogProps } from "./credit-batch-template-switch-dialog";

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
const mocks = vi.hoisted(() => ({ mutateAsync: vi.fn(), success: vi.fn(), preview: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: mocks.success }) }));
vi.mock("@/hooks/use-removal-template-review", () => ({
  useSwitchCreditBatchRemovalTemplate: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
  useRemovalTemplateReviewPreview: mocks.preview,
}));

const FACILITY_ID = "44444444-4444-4444-8444-444444444444";
const BATCH = {
  id: "33333333-3333-4333-8333-333333333333", code: "CB-26-001", facilityId: FACILITY_ID, version: 4, removalTemplateId: "rvt_old",
};

function previewResult(data: { needsReviewCount: number; enrichmentProblems?: unknown[] }) {
  return {
    isPending: false, isError: false, isFetching: false, refetch: vi.fn(),
    data: { templateId: "rvt_new", lineSourceProblems: [], enrichmentProblems: [], ...data },
  };
}
const TEMPLATES = [
  { id: "rvt_old", display_name: "Removal Template 2026-07-03", credit_type: "REMOVAL" },
  { id: "rvt_new", display_name: "Dark Earth Carbon Template", credit_type: "REMOVAL" },
  { id: "rdt_reduction", display_name: "Reduction template", credit_type: "REDUCTION" },
] as IsometricGhgEntryTemplate[];

const onClose = vi.fn();
const onStale = vi.fn();
beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn().mockImplementation(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.clearAllMocks();
  mocks.mutateAsync.mockResolvedValue({ ...BATCH, removalTemplateId: "rvt_new", version: 5 });
  mocks.preview.mockReturnValue(previewResult({ needsReviewCount: 0 }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function dialog(creditBatch: CreditBatchTemplateSwitchDialogProps["creditBatch"] = BATCH) {
  return (
    <CreditBatchTemplateSwitchDialog
      isOpen
      onClose={onClose}
      onStale={onStale}
      creditBatch={creditBatch}
      defaultTemplateId="rvt_new"
      templates={TEMPLATES}
      templatesLoading={false}
      templatesError={null}
    />
  );
}

function mount() {
  return render(dialog());
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
    // No preview for the template the batch already uses.
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it("previews how many lines of the chosen template need review without blocking the switch", async () => {
    mocks.preview.mockReturnValue(previewResult({ needsReviewCount: 2 }));
    mount();
    await screen.findByRole("dialog", { name: "Switch template" });
    await act(async () => {
      fireEvent.change(document.getElementById("removalTemplateId")!, { target: { value: "rvt_new" } });
    });

    expect(mocks.preview).toHaveBeenLastCalledWith(FACILITY_ID, "rvt_new", true);
    expect(screen.getByText("2 lines need review")).toBeTruthy();
    expect(screen.getByText("Removals for CB-26-001 stay blocked until an Owner or Admin reviews them.")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Review lines in a new tab" });
    // Straight to the chosen template, in a new tab so the unsaved choice stays here.
    expect(link.getAttribute("href")).toContain("section=removal-templates");
    expect(link.getAttribute("href")).toContain("template=rvt_new");
    expect(link.getAttribute("target")).toBe("_blank");
    expect((screen.getByRole("button", { name: "Switch template" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("says a template Isometric did not return in full blocks the Removal", async () => {
    mocks.preview.mockReturnValue(previewResult({
      needsReviewCount: 0,
      enrichmentProblems: [{ code: "unknown-enrichment", componentId: "cmp_startup", inputKey: "volume" }],
    }));
    mount();
    await screen.findByRole("dialog", { name: "Switch template" });
    await act(async () => {
      fireEvent.change(document.getElementById("removalTemplateId")!, { target: { value: "rvt_new" } });
    });

    expect(screen.getByText("Template not fully read")).toBeTruthy();
    expect(screen.getByText(/stay blocked until the template is read in full/)).toBeTruthy();
  });

  it("confirms a chosen template whose lines are all reviewed", async () => {
    mount();
    await screen.findByRole("dialog", { name: "Switch template" });
    await act(async () => {
      fireEvent.change(document.getElementById("removalTemplateId")!, { target: { value: "rvt_new" } });
    });

    expect(screen.getByText("All lines in this template are reviewed.")).toBeTruthy();
    expect(screen.queryByText(/need review/)).toBeNull();
    expect(screen.queryByRole("link", { name: "Review lines in a new tab" })).toBeNull();
  });

  it("offers a retry when the preview cannot be read and still allows the switch", async () => {
    const refetch = vi.fn();
    mocks.preview.mockReturnValue({ isPending: false, isError: true, isFetching: false, refetch, data: undefined });
    mount();
    await screen.findByRole("dialog", { name: "Switch template" });
    await act(async () => {
      fireEvent.change(document.getElementById("removalTemplateId")!, { target: { value: "rvt_new" } });
    });

    expect(screen.getByText("This template's lines could not be checked. You can still switch.")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Try again" })); });
    expect(refetch).toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Switch template" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("says set template when the batch has no pin", async () => {
    render(dialog({ ...BATCH, removalTemplateId: null }));
    await screen.findByRole("dialog", { name: "Set template" });
    await act(async () => {
      fireEvent.change(document.getElementById("removalTemplateId")!, { target: { value: "rvt_new" } });
    });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Set template" })); });
    expect(mocks.success).toHaveBeenCalledWith("Removal template set for CB-26-001.");
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

  it("keeps the choice on the opened version after a stale refusal until reloaded", async () => {
    mocks.mutateAsync.mockRejectedValueOnce(new StaleVersionError(STALE_VERSION_MESSAGE, {
      entity: "credit_batch", id: BATCH.id, code: STALE_VERSION_CONFLICT_CODE,
    }));
    const { rerender } = mount();
    await screen.findByRole("dialog", { name: "Switch template" });
    await act(async () => {
      fireEvent.change(document.getElementById("removalTemplateId")!, { target: { value: "rvt_new" } });
    });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Switch template" })); });

    expect(screen.getByText(STALE_VERSION_MESSAGE)).toBeTruthy();
    expect(onStale).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect((document.getElementById("removalTemplateId") as HTMLSelectElement).value).toBe("rvt_new");

    // The refetched batch arrives; the draft keeps the version it opened on.
    rerender(dialog({ ...BATCH, version: 5 }));
    expect((screen.getByRole("button", { name: "Switch template" }) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Discard changes and reload" })); });
    expect(screen.queryByText(STALE_VERSION_MESSAGE)).toBeNull();
    expect((document.getElementById("removalTemplateId") as HTMLSelectElement).value).toBe("rvt_old");

    await act(async () => {
      fireEvent.change(document.getElementById("removalTemplateId")!, { target: { value: "rvt_new" } });
    });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Switch template" })); });
    expect(mocks.mutateAsync).toHaveBeenLastCalledWith({
      creditBatchId: BATCH.id, removalTemplateId: "rvt_new", expectedVersion: 5,
    });
  });
});
