// @vitest-environment jsdom
import { useState, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/action-error";
import { LOCKED_FIELD_MESSAGE } from "@/lib/save-refusal";
import { transportLegFormSchema } from "@/schemas/transport-legs";
import { TransportLegForm } from "./transport-leg-form";
import { TransportLegsEditor } from "./transport-legs-editor";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/hooks/use-transport-legs", () => ({
  transportLegKeys: { all: ["transportLegs"] },
  useCreateTransportLeg: () => ({ isPending: false, mutateAsync: mocks.create, startDraft: vi.fn() }),
  useDeleteTransportLeg: () => ({ isPending: false }),
  useUpdateTransportLeg: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useTransportLegsForEntity: () => ({ data: [], error: null, isLoading: false }),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn() }) }));
vi.mock("@/components/forms/entity-select/quick-add-dialog-shell", () => ({
  stopSubmitBubbling: () => undefined,
  QuickAddDialogShell: ({ children, isOpen }: { children: ReactNode; isOpen: boolean }) => (isOpen ? <div>{children}</div> : null),
}));
vi.mock("@/components/forms", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/forms")>(),
  PositionPicker: () => null,
  DistanceCalcField: ({ onDistanceChange }: { onDistanceChange: (km: number, source: "manual") => void }) => (
    <input aria-label="Distance" onChange={(event) => onDistanceChange(Number(event.target.value), "manual")} />
  ),
}));

const savedLeg = transportLegFormSchema.parse({ distanceKm: 10, loadMassKg: 100 });
const loadMass = (container: HTMLElement) => container.querySelector<HTMLInputElement>("#loadMassKg")!;

beforeEach(() => { window.matchMedia = vi.fn().mockImplementation(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })); });
afterEach(cleanup);

/** A parent like the editor: it passes the handler's footer through, null included. */
function Parent({ refusal }: { refusal: ActionError }) {
  const [footer, setFooter] = useState<string | null>(null);
  return (
    <>
      <TransportLegForm leg={savedLeg} onCancel={vi.fn()} errorMessage={footer ?? undefined}
        onSubmit={(_data, onRefusal) => setFooter(onRefusal(refusal, "Transport leg was not saved. Try again."))} />
      <output data-testid="footer">{footer ?? "none"}</output>
    </>
  );
}

describe("TransportLegForm refused save", () => {
  it("shows a field-named refusal at its field with no footer", async () => {
    const refusal = new ActionError({ error: "Load is too high", code: "validation_failed", issues: [{ path: ["loadMassKg"], code: "validation_failed", message: "Load is too high" }] });
    const { container } = render(<Parent refusal={refusal} />);
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(container.querySelector("#loadMassKg-error")?.textContent).toBe("Load is too high"));
    expect(screen.getByTestId("footer").textContent).toBe("none");
  });

  it("puts a changed locked field back to its saved value and says so", async () => {
    const refusal = new ActionError({ error: "Leg is locked", code: "certification_locked", issues: [{ path: ["loadMassKg"], code: "certification_locked", message: "Leg is locked" }] });
    const { container } = render(<Parent refusal={refusal} />);
    fireEvent.change(loadMass(container), { target: { value: "250" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(loadMass(container).value).toBe("100"));
    expect(container.querySelector("#loadMassKg-error")?.textContent).toBe(LOCKED_FIELD_MESSAGE);
    expect(screen.getByTestId("footer").textContent).toBe("Leg is locked");
  });
});

describe("TransportLegsEditor refused create", () => {
  const openAndSubmit = () => {
    const view = render(<TransportLegsEditor entityType="sample" entityId="sample-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Add transport leg/ }));
    fireEvent.change(screen.getByLabelText("Distance"), { target: { value: "10" } });
    fireEvent.change(loadMass(view.container), { target: { value: "100" } });
    fireEvent.submit(view.container.querySelector("form")!);
    return view;
  };

  it("lands a field-named refusal at its field with no footer message", async () => {
    mocks.create.mockReset().mockRejectedValue(new ActionError({ error: "Load is too high", code: "validation_failed", issues: [{ path: ["loadMassKg"], code: "validation_failed", message: "Load is too high" }] }));
    const { container } = openAndSubmit();
    await waitFor(() => expect(container.querySelector("#loadMassKg-error")?.textContent).toBe("Load is too high"));
    // The field error plus the screen-reader summary; the footer notice is absent.
    expect(container.querySelectorAll("[role=alert]")).toHaveLength(2);
  });

  it("keeps the failure message in the footer when the refusal names no field", async () => {
    mocks.create.mockReset().mockRejectedValue(new Error("Network down"));
    openAndSubmit();
    await waitFor(() => expect(screen.getAllByText("Network down").length).toBeGreaterThan(0));
  });
});
