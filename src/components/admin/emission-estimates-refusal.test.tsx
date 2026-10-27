// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CertifierProjectRow } from "@/data-access/certification";
import { fieldRefusal } from "../../../tests/helpers/refusal-form-parent";
import { EmissionEstimatesForm } from "./emission-estimates-form";

const save = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));
vi.mock("@/hooks/use-certification", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/hooks/use-certification")>(),
  useSaveFacilityEmissionConfig: () => save,
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn() }) }));
vi.mock("@/components/ui/tooltip", () => ({
  InfoHint: () => null,
  Tooltip: ({ children }: { children: ReactNode }) => children,
}));

const mapping = { id: "mapping-1", externalFacilityId: "fcl_1", defaultSoilTemperatureC: null } as CertifierProjectRow;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderForm() {
  render(<EmissionEstimatesForm facilityId="11111111-1111-4111-8111-111111111111" mapping={mapping} durabilityOption="200_year" />);
  const input = screen.getByRole("spinbutton", { name: /Reference soil temperature/ });
  fireEvent.change(input, { target: { value: "20" } });
  fireEvent.click(screen.getByRole("button", { name: "Save estimates" }));
  return input;
}

describe("EmissionEstimatesForm refused save", () => {
  it("marks the temperature field, shows no footer and focuses it", async () => {
    save.mutateAsync.mockRejectedValue(fieldRefusal(["defaultSoilTemperatureC"], "Temperature is out of range."));
    const input = renderForm();
    await waitFor(() => expect(document.getElementById("defaultSoilTemperatureC-error")?.textContent).toContain("Temperature is out of range."));
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it("keeps a refusal that names no field in the footer", async () => {
    save.mutateAsync.mockRejectedValue(new Error("Only Admins can change this."));
    renderForm();
    expect(await screen.findByText("Only Admins can change this.")).toBeTruthy();
  });
});
