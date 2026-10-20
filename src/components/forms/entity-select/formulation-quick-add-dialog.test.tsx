// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { FormulationFormData } from "@/schemas/formulations";
import { entityKeys } from "@/hooks/entity-query-keys";
import { FormulationQuickAddDialog } from "./formulation-quick-add-dialog";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/fn/formulations", () => ({ createFormulationFn: mocks.create }));
vi.mock("./quick-add-dialog-shell", () => ({ QuickAddDialogShell: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/formulations", () => ({
  FormulationForm: ({ onSubmit, onCancel, errorMessage, submitLabel }: {
    onSubmit: (data: FormulationFormData) => Promise<void>;
    onCancel: () => void;
    errorMessage?: string;
    submitLabel: string;
  }) => <form onSubmit={(event) => { event.preventDefault(); void onSubmit(selection); }}>
    {errorMessage && <p role="alert">{errorMessage}</p>}
    <button type="submit">{submitLabel}</button>
    <button type="button" onClick={onCancel}>Cancel</button>
  </form>,
}));

const selection: FormulationFormData = {
  name: "Pure biochar", biocharRatio: 1, ingredients: [],
};
afterEach(cleanup);

it.each([true, false])("creates a formulation from the full form and handles success=%s", async (success) => {
  const entity = { id: "one", code: "F-1", name: "Pure biochar" };
  mocks.create.mockResolvedValue(success
    ? { success: true, data: { ...entity, biocharRatio: 1, ingredients: [] } }
    : { success: false, error: "Formulation was not created. Check the form." });
  const client = new QueryClient();
  const close = vi.fn();
  const created = vi.fn();
  render(<QueryClientProvider client={client}>
    <FormulationQuickAddDialog isOpen onClose={close} onSuccess={created} />
  </QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Create formulation" }));
  expect(mocks.create).toHaveBeenLastCalledWith(selection, { intentKey: expect.any(String) });
  if (success) {
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(created).toHaveBeenCalledWith(entity);
    expect(client.getQueryData(entityKeys.detail("formulation", entity.id))).toEqual(entity);
  } else {
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Formulation was not created. Check the form.");
    expect(close).not.toHaveBeenCalled();
    expect(created).not.toHaveBeenCalled();
  }
  client.clear();
});

it("retains the intent after a failed quick-add and rotates it after a save", async () => {
  mocks.create.mockClear();
  mocks.create.mockResolvedValueOnce({ success: false, error: "Save again" })
    .mockResolvedValue({ success: true, data: { id: "one", code: "F-1", name: "Pure biochar" } });
  const client = new QueryClient();
  const created = vi.fn();
  const { unmount } = render(<QueryClientProvider client={client}>
    <FormulationQuickAddDialog isOpen onClose={() => undefined} onSuccess={created} />
  </QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Create formulation" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Create formulation" }));
  await waitFor(() => expect(created).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "Create formulation" }));
  await waitFor(() => expect(created).toHaveBeenCalledTimes(2));
  const keys = mocks.create.mock.calls.map(([, options]) => options.intentKey);
  expect(keys[1]).toBe(keys[0]);
  expect(keys[2]).not.toBe(keys[0]);
  unmount();
  client.clear();
});

it("starts a new draft key when the dialog closes after a failed save", async () => {
  mocks.create.mockClear();
  mocks.create.mockResolvedValue({ success: false, error: "Save again" });
  const client = new QueryClient();
  const close = vi.fn();
  const { unmount } = render(<QueryClientProvider client={client}>
    <FormulationQuickAddDialog isOpen onClose={close} />
  </QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Create formulation" }));
  await screen.findByRole("alert");
  // Same open draft: the retry keeps the key.
  fireEvent.click(screen.getByRole("button", { name: "Create formulation" }));
  await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
  // Close and reopen (the shell stays mounted), then a new entry.
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(close).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Create formulation" }));
  await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(3));
  const keys = mocks.create.mock.calls.map(([, options]) => options.intentKey);
  expect(keys[1]).toBe(keys[0]);
  expect(keys[2]).not.toBe(keys[0]);
  unmount();
  client.clear();
});
