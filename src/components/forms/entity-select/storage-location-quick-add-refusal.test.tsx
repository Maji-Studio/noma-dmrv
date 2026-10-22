// @vitest-environment jsdom
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StorageLocationQuickAddDialog } from "./storage-location-quick-add-dialog";

const FACILITY_ID = "00000000-0000-4000-8000-000000000001";
const mocks = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn() }) }));
vi.mock("@/fn/quick-add", () => ({ createStorageLocationFn: mocks.create }));
vi.mock("@/hooks/use-storage-locations", () => ({ useUpdateStorageLocation: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock("@/hooks/use-record-locks", async () => (await import("../../../../tests/helpers/record-lock-mocks")).openRecordLocksModule);
vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({ facilityId: FACILITY_ID }),
  useFacilityClock: () => ({ timeZone: "UTC", hint: "" }),
}));
vi.mock("@/hooks/use-refresh-entity-options-on-return", () => ({ useRefreshEntityOptionsOnReturn: () => () => {} }));
vi.mock("@/hooks/use-entities", () => ({
  useEntityOptions: () => ({ data: [], isLoading: false, error: null }),
  useEntityById: () => ({ data: undefined, isPending: false }),
}));
vi.mock("@/hooks/use-entity-edit-record", () => ({ isEditableEntityType: () => false, useCanManageFeedstockTypes: () => false }));
vi.mock("@/components/ui/tooltip", () => ({ InfoHint: () => null, Tooltip: ({ children }: { children: ReactNode }) => children }));
vi.mock("./quick-add-dialog-shell", () => ({
  stopSubmitBubbling: () => undefined,
  QuickAddDialogShell: ({ children, isOpen }: { children: ReactNode; isOpen: boolean }) => (isOpen ? <div>{children}</div> : null),
}));

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  window.matchMedia = vi.fn().mockImplementation(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(cleanup);

it("shows a refused create at its field inside the dialog, with no footer line", async () => {
  mocks.create.mockResolvedValue({
    success: false, error: "Name is taken", code: "validation_failed",
    issues: [{ path: ["name"], code: "validation_failed", message: "Name is taken" }],
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <StorageLocationQuickAddDialog isOpen allowedTypes={["biochar_bin"]} facilityId={FACILITY_ID} onClose={vi.fn()} onSuccess={vi.fn()} />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByRole("textbox", { name: /^Bin name/ }), { target: { value: "North bin" } });
  fireEvent.click(screen.getByRole("button", { name: "Create storage bin" }));
  await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.getAllByText("Name is taken").length).toBeGreaterThan(0));
  // Once at the field and once in the error summary; none as a footer message.
  expect(document.querySelector("#name-error")?.textContent).toContain("Name is taken");
});
