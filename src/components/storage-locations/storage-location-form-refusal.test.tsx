// @vitest-environment jsdom
import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/action-error";
import { LOCKED_FIELD_MESSAGE } from "@/lib/save-refusal";
import type { StorageLocation } from "@/db/schema/facilities";
import type { RecordLockView } from "@/lib/record-lock-view";
import { StorageLocationForm } from "./storage-location-form";

const FACILITY_ID = "00000000-0000-4000-8000-000000000001";

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
vi.mock("@/components/ui/tooltip", () => ({
  InfoHint: () => null,
  Tooltip: ({ children }: { children: ReactNode }) => children,
}));

const saved = {
  id: "bin", name: "North bin", type: "biochar_bin", facilityId: FACILITY_ID, capacityKg: null,
  feedstockTypeId: null, formulationId: null, stockMode: "split", drawOrder: "oldest_first",
  storageMethod: null, storageDescription: null,
} as unknown as StorageLocation;

const OPEN_LOCK: RecordLockView = { level: "open", heldBy: [], usedBy: [], freeFields: [], howToFree: null, returnedBy: [] };
const LOCK_MESSAGE = "This bin has stock history.";
const fieldRefusal = new ActionError({ error: "Name is taken", code: "validation_failed", issues: [{ path: ["name"], code: "validation_failed", message: "Name is taken" }] });
const lockRefusal = new ActionError({ error: LOCK_MESSAGE, code: "certification_locked", issues: [{ path: ["type"], code: "certification_locked", message: LOCK_MESSAGE }] });

/** A parent like the bin sheet: it passes the handler's footer through, null included. */
function Parent({ refusal, storageLocation }: { refusal: ActionError; storageLocation?: StorageLocation }) {
  const allowedTypes = storageLocation ? (["biochar_bin", "product_bin"] as const) : (["biochar_bin"] as const);
  const [footer, setFooter] = useState<string | null>(null);
  return (
    <>
      <StorageLocationForm
        storageLocation={storageLocation}
        lock={OPEN_LOCK}
        allowedTypes={allowedTypes}
        defaultFacilityId={FACILITY_ID}
        onSubmit={(_data, onRefusal) => setFooter(onRefusal(refusal, "Storage bin was not saved. Try again."))}
        onCancel={vi.fn()}
        errorMessage={footer ?? undefined}
      />
      <output data-testid="footer">{footer ?? "none"}</output>
    </>
  );
}

const renderParent = (props: Parameters<typeof Parent>[0]) =>
  render(<QueryClientProvider client={new QueryClient()}><Parent {...props} /></QueryClientProvider>);
const nameInput = () => screen.getByRole("textbox", { name: /^Bin name/ }) as HTMLInputElement;

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  window.matchMedia = vi.fn().mockImplementation(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(cleanup);

describe("StorageLocationForm refused save", () => {
  it("shows a field-named refusal at its field with no footer", async () => {
    renderParent({ refusal: fieldRefusal });
    fireEvent.change(nameInput(), { target: { value: "North bin" } });
    fireEvent.submit(nameInput().closest("form")!);
    await waitFor(() => expect(screen.getAllByText("Name is taken").length).toBeGreaterThan(0));
    expect(screen.getByTestId("footer").textContent).toBe("none");
  });

  it("puts a changed locked storage type back to its saved value", async () => {
    renderParent({ refusal: lockRefusal, storageLocation: saved });
    const radio = (value: string) => document.querySelector<HTMLInputElement>(`input[name="type"][value="${value}"]`)!;
    fireEvent.click(radio("product_bin"));
    expect(radio("product_bin").checked).toBe(true);
    fireEvent.submit(nameInput().closest("form")!);
    await waitFor(() => expect(radio("product_bin").checked).toBe(false));
    expect(radio("biochar_bin").checked).toBe(true);
    expect(screen.getAllByText(LOCKED_FIELD_MESSAGE).length).toBeGreaterThan(0);
    expect(screen.getByTestId("footer").textContent).toBe(LOCK_MESSAGE);
  });
});
