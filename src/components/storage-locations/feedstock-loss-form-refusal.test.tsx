// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/action-error";
import { LOCKED_FIELD_MESSAGE } from "@/lib/save-refusal";
import { throwRecordLossError } from "@/hooks/use-bin-movements";

const mocks = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityClock: () => ({ timeZone: "UTC", hint: undefined }) }));
vi.mock("@/hooks/use-bin-movements", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/hooks/use-bin-movements")>(),
  useRecordLoss: () => ({ isPending: false, mutateAsync: mocks.record }),
}));
import { FeedstockLossForm } from "./feedstock-loss-form";

afterEach(cleanup);

/** The refusal the way the mutation throws it: through the loss action's error seam. */
function refuse(issues: ActionError["issues"], code: ActionError["code"] = "validation_failed", error = "Refused") {
  try {
    throwRecordLossError({ success: false, error, code, issues });
  } catch (thrown) {
    return thrown as Error;
  }
  throw new Error("expected a throw");
}

function renderForm() {
  const view = render(<FeedstockLossForm storageLocationId="00000000-0000-4000-8000-000000000002" facilityId="00000000-0000-4000-8000-000000000003" availableKg={500} moisturePercent={20} onCancel={vi.fn()} />);
  fireEvent.change(view.container.querySelector("#loss-amount")!, { target: { value: "50" } });
  fireEvent.change(view.container.querySelector("#loss-reason")!, { target: { value: "Rain on the pile" } });
  fireEvent.submit(view.container.querySelector("form")!);
  return view;
}

describe("FeedstockLossForm refused save", () => {
  it("keeps the refusal's issues so the form can show them", () => {
    expect(refuse([{ path: ["reason"], code: "validation_failed", message: "Say more." }])).toBeInstanceOf(ActionError);
  });

  it("shows a field-named refusal at its field with no footer message", async () => {
    mocks.record.mockReset().mockRejectedValue(refuse([{ path: ["reason"], code: "validation_failed", message: "Say what happened." }]));
    const { container } = renderForm();
    await waitFor(() => expect(container.querySelector("#loss-reason-error")?.textContent).toBe("Say what happened."));
    expect(screen.queryAllByRole("alert").map((node) => node.textContent)).not.toContain("Refused");
  });

  it("puts a locked field back to its saved value and says so", async () => {
    mocks.record.mockReset().mockRejectedValue(refuse([{ path: ["reason"], code: "certification_locked", message: "This bin is locked." }], "certification_locked", "This bin is locked."));
    const { container } = renderForm();
    await waitFor(() => expect((container.querySelector("#loss-reason") as HTMLTextAreaElement).value).toBe(""));
    expect(container.querySelector("#loss-reason-error")?.textContent).toBe(LOCKED_FIELD_MESSAGE);
  });

  it("keeps the message for a refusal that names no field", async () => {
    mocks.record.mockReset().mockRejectedValue(refuse([], "validation_failed", "The loss was refused."));
    renderForm();
    await waitFor(() => expect(screen.getAllByText("The loss was refused.").length).toBeGreaterThan(0));
  });
});
