// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";
import { fieldRefusal } from "../../../tests/helpers/refusal-form-parent";
import { OrganizationDefaultsForm } from "./organization-defaults-form";

const save = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityContext: () => ({ activeOrganizationId: "org-1" }) }));
vi.mock("@/hooks/use-organization-settings", () => ({
  useOrganizationDefaults: () => ({
    isLoading: false,
    data: {
      defaults: { defaultCountry: "Kenya", defaultTimezone: "Africa/Nairobi", defaultEvidenceMethod: "location", defaultPackaging: "bagged" },
      viewerCanManage: true,
    },
  }),
  useSaveOrganizationDefaults: () => save,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OrganizationDefaultsForm refused save", () => {
  it("marks the country field, lists it in the summary and focuses it", async () => {
    save.mutateAsync.mockRejectedValue(fieldRefusal(["defaultCountry"], "Country is not recognised."));
    render(<ToastProvider><OrganizationDefaultsForm /></ToastProvider>);
    const country = screen.getByRole("textbox", { name: /Country/ });
    fireEvent.change(country, { target: { value: "Nowhere" } });
    fireEvent.click(screen.getByRole("button", { name: "Save defaults" }));

    await waitFor(() => expect(document.getElementById("default-country-error")?.textContent).toContain("Country is not recognised."));
    expect(screen.getByText("Not saved. Fix 1 field.")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(country));
  });
});
