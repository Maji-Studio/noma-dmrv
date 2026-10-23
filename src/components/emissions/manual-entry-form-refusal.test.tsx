// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/action-error";
import { LOCKED_FIELD_MESSAGE } from "@/lib/save-refusal";
import { makeEntry, makeLine } from "./emission-line-test-fixtures";
import { ManualEntryForm } from "./manual-entry-form";

const mutations = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), replace: vi.fn(), pending: false }));

vi.mock("@/hooks/use-emission-entries", () => ({
  useCreateEmissionEntry: () => ({ isPending: mutations.pending, mutateAsync: mutations.create }),
  useUpdateEmissionEntry: () => ({ isPending: false, mutateAsync: mutations.update }),
  useReplaceEmissionEntry: () => ({ isPending: false, mutateAsync: mutations.replace }),
  invalidateEmissionEntryReads: vi.fn(),
}));
vi.mock("@/components/ui/slide-over-panel", () => {
  const Plain = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const Footer = ({ children, preview }: { children?: React.ReactNode; preview?: React.ReactNode }) => (
    <div>{preview}{children}</div>
  );
  return {
    SlideOverPanelBody: Plain,
    SlideOverPanelDescription: Plain,
    SlideOverPanelFooter: Footer,
    SlideOverPanelHeader: Plain,
    SlideOverPanelTitle: Plain,
  };
});
vi.mock("@/hooks/use-deferred-attachments", () => ({
  useDeferredAttachments: () => ({ attachments: [], hasHeld: false, add: vi.fn(), remove: vi.fn(), flush: vi.fn(), clear: vi.fn() }),
}));

const SCOPE = { facilityId: "fac", creditBatchId: "cb" };
const BATCH = { creditBatchId: "cb", code: "CB-1", startDate: "2026-09-01", endDate: "2026-09-30" };
const FALLBACK = "The manual entry was not saved. Check the values and try again.";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mutations.pending = false;
});

function renderForm(mode: React.ComponentProps<typeof ManualEntryForm>["mode"] = { kind: "add" }, onSaved = vi.fn(), line = makeLine()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ManualEntryForm line={line} batch={BATCH} scope={SCOPE} today="2026-09-20" mode={mode} onCancel={vi.fn()} onSaved={onSaved} />
    </QueryClientProvider>,
  );
  return onSaved;
}
const energy = () => screen.getByRole("textbox", { name: /Energy/ });
const refusal = (issues: ConstructorParameters<typeof ActionError>[0]["issues"]) =>
  new ActionError({ error: "Not saved.", code: "validation_failed", issues });

describe("ManualEntryForm save", () => {
  it("creates the entry and reports the save when the values are valid", async () => {
    mutations.create.mockResolvedValue({ id: "entry-9" });
    const onSaved = renderForm();
    fireEvent.change(energy(), { target: { value: " 12.5 " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({}));
    expect(mutations.create).toHaveBeenCalledTimes(1);
    expect(mutations.create.mock.calls[0][0]).toMatchObject({
      creditBatchId: "cb",
      componentId: "line-1",
      occurredOn: "2026-09-20",
      note: null,
      values: [{ inputKey: "energy", magnitude: "12.5", unit: "kWh" }],
    });
  });

  it("shows the schema's messages at the fields and sends nothing", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "x".repeat(4001) } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Enter a non-negative decimal value.")).toBeTruthy();
    expect(screen.getByText("Use 4,000 characters or fewer.")).toBeTruthy();
    expect(mutations.create).not.toHaveBeenCalled();
  });

  it("sends one save when the form is submitted twice in the same tick", async () => {
    let finish: (value: { id: string }) => void = () => undefined;
    mutations.create.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const onSaved = renderForm();
    fireEvent.change(energy(), { target: { value: "3" } });
    const form = energy().closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(mutations.create).toHaveBeenCalledTimes(1));
    finish({ id: "entry-9" });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(mutations.create).toHaveBeenCalledTimes(1);
  });
});

describe("ManualEntryForm submit", () => {
  it("lets Enter in a field submit through the Save button, which names the form", () => {
    renderForm();
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.type).toBe("submit");
    // A button owned by the form is its default button, so Enter submits without a hidden one.
    expect(save.form).toBe(energy().closest("form"));
    expect(document.querySelectorAll("button[hidden]").length).toBe(0);
  });

  it("blocks Save and a submit while a save is pending", () => {
    mutations.pending = true;
    renderForm();
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(save.getAttribute("aria-busy")).toBe("true");
    fireEvent.change(energy(), { target: { value: "3" } });
    fireEvent.submit(energy().closest("form")!);
    expect(mutations.create).not.toHaveBeenCalled();
  });
});

describe("ManualEntryForm whole-entry lock", () => {
  it("turns read-only with the refusal at the top and no Save", async () => {
    // What lockWritableEmissionEntry sends: the lock code, no issues.
    mutations.update.mockRejectedValue(new ActionError({ error: "This emissions entry is reserved or sent. It cannot be changed.", code: "certification_locked" }));
    renderForm({ kind: "edit", entry: makeEntry() });
    fireEvent.change(energy(), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const message = await screen.findByText("Your changes were not saved.");
    expect(screen.getAllByText(/reserved or sent/)).toHaveLength(1);
    expect(screen.getAllByText(/Your changes were not saved/)).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
    expect(energy().matches(":disabled")).toBe(true);
    expect(screen.getByLabelText("Note").matches(":disabled")).toBe(true);
    // Above the fields.
    expect(message.compareDocumentPosition(energy()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // A named group, not a live alert; the typed value went back to the saved one.
    const group = screen.getByRole("group", { name: /Your changes were not saved\./ });
    expect(group.textContent).toBe("Your changes were not saved. This emissions entry is reserved or sent. It cannot be changed.");
    expect(group.querySelector("[role='alert']")).toBeNull();
    expect(energy()).toHaveProperty("value", "42.5");
    await waitFor(() => expect(document.activeElement).toBe(group));
    // A re-render does not pull focus back.
    group.blur();
    fireEvent.change(energy(), { target: { value: "7" } });
    expect(document.activeElement).not.toBe(group);
  });
});

describe("ManualEntryForm saved values after the lock", () => {
  it("shows the saved value, date and note again, not the typed ones", async () => {
    mutations.update.mockRejectedValue(new ActionError({ error: "This emissions entry is reserved or sent. It cannot be changed.", code: "certification_locked" }));
    renderForm({ kind: "edit", entry: makeEntry({ occurredOn: "2026-09-12", note: "Saved note" }) });
    const date = () => screen.getByLabelText("Date");
    expect(date()).toHaveProperty("value", "2026-09-12");
    fireEvent.change(energy(), { target: { value: "9" } });
    fireEvent.change(date(), { target: { value: "2026-09-15" } });
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Typed note" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("group", { name: /Your changes were not saved/ });
    expect(energy()).toHaveProperty("value", "42.5");
    expect(date()).toHaveProperty("value", "2026-09-12");
    expect(screen.getByLabelText("Note")).toHaveProperty("value", "Saved note");
  });
});

describe("ManualEntryForm error summary", () => {
  it("counts the refused fields and focuses the first", async () => {
    mutations.create.mockRejectedValue(refusal([{ path: ["values", 0, "magnitude"], code: "too_big", message: "Use 100 characters or fewer." }]));
    renderForm();
    fireEvent.change(energy(), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Not saved. Fix 1 field.")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(energy()));
  });
});

describe("ManualEntryForm refusals", () => {
  it("lands a refusal that names the value at its field, with no footer", async () => {
    // The issue path the server sends for a rejected magnitude (createEmissionEntrySchema).
    mutations.create.mockRejectedValue(refusal([{ path: ["values", 0, "magnitude"], code: "too_big", message: "Use 100 characters or fewer." }]));
    const onSaved = renderForm();
    fireEvent.change(energy(), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Use 100 characters or fewer.")).toBeTruthy();
    expect(document.getElementById("entry-line-1-energy-error")?.textContent).toBe("Use 100 characters or fewer.");
    expect(screen.queryByText("Not saved.")).toBeNull();
    expect(onSaved).not.toHaveBeenCalled();
    // No error summary on this form: focus moves to the refused field.
    await waitFor(() => expect(document.activeElement).toBe(energy()));
  });

  it("lands an occurredOn refusal at the date", async () => {
    mutations.create.mockRejectedValue(refusal([{ path: ["occurredOn"], code: "invalid_format", message: "Invalid ISO date" }]));
    renderForm();
    fireEvent.change(energy(), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(document.getElementById("entry-line-1-date-error")?.textContent).toBe("Invalid ISO date"));
    expect(screen.queryByText("Not saved.")).toBeNull();
  });

  it("lands a refusal on the Mass part of a mass-distance line and sends the computed total to the footer", async () => {
    const line = makeLine({ unit: "km * tonne", inputShape: [{ key: "md", type: "monitored", quantityKind: "mass_distance", unit: "km * tonne" }] });
    mutations.create.mockRejectedValue(refusal([{ path: ["values", 0, "massDistanceDetail", "mass", "magnitude"], code: "too_big", message: "Mass is too long." }]));
    renderForm({ kind: "add" }, vi.fn(), line);
    fireEvent.change(screen.getByRole("textbox", { name: /Mass/ }), { target: { value: "5" } });
    fireEvent.change(screen.getByRole("textbox", { name: /Distance/ }), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(document.getElementById("entry-line-1-md:mass-error")?.textContent).toBe("Mass is too long."));
    expect(screen.queryByText("Not saved.")).toBeNull();
    cleanup();
    mutations.create.mockRejectedValue(refusal([{ path: ["values", 0, "magnitude"], code: "too_big", message: "The total is too long." }]));
    renderForm({ kind: "add" }, vi.fn(), line);
    fireEvent.change(screen.getByRole("textbox", { name: /Mass/ }), { target: { value: "5" } });
    fireEvent.change(screen.getByRole("textbox", { name: /Distance/ }), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/The total is too long/)).toBeTruthy();
    expect(document.getElementById("entry-line-1-md:mass-error")).toBeNull();
    expect(document.getElementById("entry-line-1-md:distance-error")).toBeNull();
  });

  it("maps the second input of a single line to its own field", async () => {
    const line = makeLine({
      entryPolicy: "single",
      inputShape: [
        { key: "conc", type: "monitored", quantityKind: "mass_fraction", unit: "kg/kg" },
        { key: "flow", type: "monitored", quantityKind: "mass", unit: "kg" },
      ],
    } as never);
    mutations.create.mockRejectedValue(refusal([{ path: ["values", 1, "magnitude"], code: "too_big", message: "Flow is too long." }]));
    renderForm({ kind: "add" }, vi.fn(), line);
    fireEvent.change(screen.getByRole("textbox", { name: /Concentration/ }), { target: { value: "1" } });
    fireEvent.change(screen.getByRole("textbox", { name: /Total mass flow/ }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(document.getElementById("entry-line-1-flow-error")?.textContent).toBe("Flow is too long."));
    expect(document.getElementById("entry-line-1-conc-error")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: /Total mass flow/ })));
  });

  it("keeps the footer for a refusal that names no field", async () => {
    mutations.create.mockRejectedValue(new Error("boom"));
    renderForm();
    fireEvent.change(energy(), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("boom")).toBeTruthy();
  });

  it("shows the fallback footer for an ActionError without issues", async () => {
    mutations.create.mockRejectedValue(new ActionError({ error: FALLBACK }));
    renderForm();
    fireEvent.change(energy(), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Not saved. Check the values and try again.")).toBeTruthy();
  });

  // Form contract test, not a real server shape: the server's lock refusal
  // (lockWritableEmissionEntry) names no field, so it reads in the footer. This
  // proves the revert path should a lock issue ever name the note.
  it("puts a changed field back and says it is locked when a lock names it", async () => {
    mutations.update.mockRejectedValue(
      new ActionError({
        error: "This emissions entry is reserved or sent. It cannot be changed.",
        code: "certification_locked",
        issues: [{ path: ["note"], code: "certification_locked", message: "This emissions entry is reserved or sent. It cannot be changed." }],
      }),
    );
    renderForm({ kind: "edit", entry: makeEntry({ note: "Saved note" }) });
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Changed note" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(LOCKED_FIELD_MESSAGE)).toBeTruthy();
    expect(screen.getByLabelText("Note")).toHaveProperty("value", "Saved note");
  });
});
