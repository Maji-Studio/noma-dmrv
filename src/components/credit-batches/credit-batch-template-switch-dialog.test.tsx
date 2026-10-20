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
      {options?.map((option) => <option key={option.id} value={option.id} disabled={option.disabled}>{option.name}</option>)}
    </select>
  ),
}));
const mocks = vi.hoisted(() => ({ mutateAsync: vi.fn(), success: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: mocks.success }) }));
vi.mock("@/hooks/use-removal-template-review", () => ({
  useSwitchCreditBatchRemovalTemplate: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
}));

const FACILITY_ID = "44444444-4444-4444-8444-444444444444";
const BATCH = {
  id: "33333333-3333-4333-8333-333333333333", code: "CB-26-001", facilityId: FACILITY_ID, version: 4, removalTemplateId: "rvt_old",
};

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
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function dialog(
  creditBatch: CreditBatchTemplateSwitchDialogProps["creditBatch"] = BATCH,
  readiness?: CreditBatchTemplateSwitchDialogProps["readiness"],
) {
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
      readiness={readiness}
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
  });

  it("disables templates that are not ready, says why, and links each to Removal templates", async () => {
    render(dialog(BATCH, new Map([
      ["rvt_old", { ready: false, reason: "2 components to decide" }],
      ["rvt_new", { ready: false, reason: "3 components to decide", toDecide: 3 }],
    ])));
    await screen.findByRole("dialog", { name: "Switch template" });
    const select = document.getElementById("removalTemplateId") as HTMLSelectElement;
    const option = (id: string) => [...select.options].find((candidate) => candidate.value === id)!;
    // The current template stays selectable even when it is not ready.
    expect(option("rvt_old").disabled).toBe(false);
    expect(option("rvt_new").disabled).toBe(true);
    expect(screen.getByText("Not ready for credit batches")).toBeTruthy();
    expect(screen.getByText("3 components to decide")).toBeTruthy();
    expect(screen.queryByText("2 components to decide")).toBeNull();
    const link = screen.getByRole("link", { name: /^Decide components/ });
    // Straight to that template, in a new tab so the unsaved choice stays here.
    expect(link.getAttribute("href")).toContain("/settings/removal-templates?");
    expect(link.getAttribute("href")).toContain("template=rvt_new");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("lets a ready template be chosen and shows no notice", async () => {
    render(dialog(BATCH, new Map([["rvt_old", { ready: true }], ["rvt_new", { ready: true }]])));
    await screen.findByRole("dialog", { name: "Switch template" });
    const select = document.getElementById("removalTemplateId") as HTMLSelectElement;
    expect([...select.options].every((option) => !option.disabled)).toBe(true);
    expect(screen.queryByText("Not ready for credit batches")).toBeNull();
    await act(async () => {
      fireEvent.change(select, { target: { value: "rvt_new" } });
    });
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

  it("keeps only the current template choosable when readiness cannot be read", async () => {
    const retry = vi.fn();
    render(
      <CreditBatchTemplateSwitchDialog
        isOpen onClose={onClose} onStale={onStale} creditBatch={BATCH} defaultTemplateId="rvt_new"
        templates={TEMPLATES} templatesLoading={false} templatesError={null}
        readinessError onRetryReadiness={retry}
      />,
    );
    await screen.findByRole("dialog", { name: "Switch template" });
    const select = document.getElementById("removalTemplateId") as HTMLSelectElement;
    const option = (id: string) => [...select.options].find((candidate) => candidate.value === id)!;
    expect(option("rvt_old").disabled).toBe(false);
    expect(option("rvt_new").disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("links a template that is not set up to Removal templates without saying Decide components", async () => {
    render(dialog(BATCH, new Map([["rvt_new", { ready: false, reason: "Not set up yet", toDecide: 0 }]])));
    await screen.findByRole("dialog", { name: "Switch template" });
    expect(screen.queryByRole("link", { name: /^Decide components/ })).toBeNull();
    expect(screen.getByRole("link", { name: /^Open Removal templates/ }).getAttribute("href")).toContain("template=rvt_new");
  });

  it("enables a non-current template only when it is known to be ready", async () => {
    const readiness = new Map([
      ["rvt_old", { ready: false, reason: "2 components to decide", toDecide: 2 }],
      ["rvt_other", { ready: true }],
      ["rvt_undecided", { ready: false, reason: "2 components to decide", toDecide: 2 }],
      ["rvt_unread", { ready: false, reason: "Not fully read" }],
    ]);
    const templates = [
      ...TEMPLATES,
      { id: "rvt_other", display_name: "Ready Template", credit_type: "REMOVAL" },
      { id: "rvt_undecided", display_name: "Undecided Template", credit_type: "REMOVAL" },
      { id: "rvt_unread", display_name: "Unread Template", credit_type: "REMOVAL" },
    ] as IsometricGhgEntryTemplate[];
    render(
      <CreditBatchTemplateSwitchDialog
        isOpen onClose={onClose} onStale={onStale} creditBatch={BATCH} defaultTemplateId={null}
        templates={templates} templatesLoading={false} templatesError={null} readiness={readiness}
      />,
    );
    await screen.findByRole("dialog", { name: "Switch template" });
    const select = document.getElementById("removalTemplateId") as HTMLSelectElement;
    const disabled = (id: string) => [...select.options].find((candidate) => candidate.value === id)!.disabled;
    expect(disabled("rvt_old")).toBe(false);
    expect(disabled("rvt_other")).toBe(false);
    // rvt_new has no readiness entry (still loading or newly added): not known to be ready.
    expect(disabled("rvt_new")).toBe(true);
    expect(disabled("rvt_undecided")).toBe(true);
    expect(disabled("rvt_unread")).toBe(true);
    expect(screen.getAllByRole("link", { name: /^Decide components/ })).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: /^Open Removal templates/ })).toHaveLength(1);
  });

  it("keeps a template without a readiness entry disabled while readiness loads", async () => {
    render(
      <CreditBatchTemplateSwitchDialog
        isOpen onClose={onClose} onStale={onStale} creditBatch={BATCH} defaultTemplateId={null}
        templates={TEMPLATES} templatesLoading={false} templatesError={null} readiness={new Map()} readinessLoading
      />,
    );
    await screen.findByRole("dialog", { name: "Switch template" });
    const select = document.getElementById("removalTemplateId") as HTMLSelectElement;
    expect([...select.options].find((candidate) => candidate.value === "rvt_new")!.disabled).toBe(true);
    expect([...select.options].find((candidate) => candidate.value === "rvt_old")!.disabled).toBe(false);
  });
});
