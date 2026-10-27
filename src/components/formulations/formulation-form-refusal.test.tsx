// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { get, useFormState, type Control } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FormulationWithIngredients } from "@/data-access/formulations";
import { fieldRefusal, RefusalParent } from "../../../tests/helpers/refusal-form-parent";
import { FormulationForm } from "./formulation-form";

const FALLBACK = "Formulation was not saved. Try again.";
const TYPE_ID = "00000000-0000-4000-8000-0000000000aa";

vi.mock("@/hooks/use-entities", () => ({ useEntityOptions: () => ({ data: [] }) }));
// A named control per row, so the form finds the field on screen like the real picker.
vi.mock("@/components/forms/entity-select", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/forms/entity-select")>(),
  FormEntitySelect: function MaterialSelect({ name, control }: { name: string; control: Control }) {
    const { errors } = useFormState({ control });
    return <><input aria-label="Blend material" data-field-name={name} readOnly={false} /><span data-testid={`error-${name}`}>{String(get(errors, name)?.message ?? "")}</span></>;
  },
}));
vi.mock("@/components/ui/tooltip", () => ({
  InfoHint: ({ label }: { children: ReactNode; label?: string }) => <span aria-label={label} />,
  Tooltip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

const saved = {
  id: "formulation", name: "Garden blend", description: "", biocharRatio: "0.7",
  ingredients: [{ feedstockTypeId: TYPE_ID, ratio: "0.3" }],
} as unknown as FormulationWithIngredients;

function renderRefused(refusal: unknown) {
  render(
    <RefusalParent refusal={refusal} fallback={FALLBACK}>
      {(props) => <FormulationForm formulation={saved} {...props} />}
    </RefusalParent>,
  );
  fireEvent.submit(screen.getByRole("textbox", { name: /^Formulation name/ }).closest("form")!);
}

afterEach(cleanup);

describe("FormulationForm refused save", () => {
  // Real server shape: the ratio sum refusal sits at ["biocharRatio"]; the form shows percent.
  it("shows the over-allocated refusal at the biochar share with no footer", async () => {
    renderRefused(fieldRefusal(["biocharRatio"], "Shares add up to more than 100%."));
    await waitFor(() => expect(document.querySelector("#biocharPercent-error")?.textContent).toContain("more than 100%"));
    expect(screen.getByTestId("footer").textContent).toBe("none");
  });

  // Real server shape: a validated payload names the ingredient row's ratio.
  it("shows an ingredient ratio refusal at that row's share field", async () => {
    renderRefused(fieldRefusal(["ingredients", 0, "ratio"], "Share must be between 0 and 100."));
    await waitFor(() => expect(document.querySelector("[id='ingredients.0.sharePercent-error']")?.textContent).toContain("between 0 and 100"));
    expect(screen.getByTestId("footer").textContent).toBe("none");
  });

  // Real server shape: formulationTypeNotBlend names the row as `lines`, not `ingredients`.
  it("shows a refused blend material at that row's material field", async () => {
    renderRefused(fieldRefusal(["lines", 0, "feedstockTypeId"], "Formulation lines must use blend-usage feedstock types"));
    await waitFor(() => expect(screen.getByTestId("error-ingredients.0.feedstockTypeId").textContent).toBe("Formulation lines must use blend-usage feedstock types"));
    expect(screen.getByTestId("footer").textContent).toBe("none");
  });

  // Real server shape: formulationLineInUse names ["lines"], which no single control answers to.
  it("keeps a refusal about the whole ingredient list in the footer", async () => {
    renderRefused(fieldRefusal(["lines"], "This line is used by saved biochar products, so it cannot be removed.", "conflict"));
    await waitFor(() => expect(screen.getByTestId("footer").textContent).toContain("cannot be removed"));
  });
});
