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
  FormulationForm: ({ onSubmit, errorMessage, submitLabel }: {
    onSubmit: (data: FormulationFormData) => Promise<void>;
    errorMessage?: string;
    submitLabel: string;
  }) => <form onSubmit={(event) => { event.preventDefault(); void onSubmit(selection); }}>
    {errorMessage && <p role="alert">{errorMessage}</p>}
    <button type="submit">{submitLabel}</button>
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
  expect(mocks.create).toHaveBeenLastCalledWith(selection);
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
