// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORGANIZATION_SETTINGS } from "@/config/organization-settings";
import type { Facility } from "@/db/schema/facilities";
import { ActionError } from "@/lib/action-error";
import { fieldRefusal, RefusalParent } from "../../../tests/helpers/refusal-form-parent";
import { FacilityForm } from "./facility-form";

const FALLBACK = "Facility was not saved. Try again.";
vi.mock("@/hooks/use-organization-settings", () => ({
  useOrganizationDefaultValues: () => ({ defaults: { ...DEFAULT_ORGANIZATION_SETTINGS }, isLoading: false }),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/hooks/use-geo", () => ({
  useGeoCapabilities: () => ({ data: undefined }),
  useReverseGeocode: () => ({ data: undefined }),
}));
vi.mock("@/components/forms/position-picker/address-search", () => ({ AddressSearch: () => null }));
vi.mock("@/components/ui/tooltip", () => ({ InfoHint: () => null, Tooltip: ({ children }: { children: ReactNode }) => children }));

const saved = {
  id: "facility", name: "North site", country: "Tanzania", location: "", address: "", gpsLatitude: -3.3, gpsLongitude: 37.3,
  contactEmail: "", contactPhone: "", timezone: "Africa/Dar_es_Salaam",
} as unknown as Facility;

function renderRefused(refusal: unknown) {
  render(
    <RefusalParent refusal={refusal} fallback={FALLBACK}>
      {(props) => <FacilityForm facility={saved} {...props} />}
    </RefusalParent>,
  );
  fireEvent.submit(screen.getByRole("textbox", { name: /^Facility name/ }).closest("form")!);
}

afterEach(cleanup);

describe("FacilityForm refused save", () => {
  it("shows a field-named refusal at its field with no footer", async () => {
    renderRefused(fieldRefusal(["contactEmail"], "Enter a valid email address"));
    await waitFor(() => expect(document.querySelector("#contactEmail-error")?.textContent).toContain("Enter a valid email address"));
    expect(screen.getByTestId("footer").textContent).toBe("none");
  });

  it("shows a timezone refusal at the timezone field", async () => {
    renderRefused(fieldRefusal(["timezone"], "Choose a timezone from the list"));
    await waitFor(() => expect(screen.getAllByText("Choose a timezone from the list").length).toBeGreaterThan(0));
    expect(screen.getByTestId("footer").textContent).toBe("none");
  });

  // The tier refusal names no field and the form has no tier field, so a
  // facility save cannot reach the "Locked" field message; the footer keeps the reason.
  it("keeps a lock refusal that names no field as the caller's fallback", async () => {
    renderRefused(new ActionError({ error: "Cannot change this facility's durability tier.", code: "certification_locked" }));
    await waitFor(() => expect(screen.getByTestId("footer").textContent).toBe(FALLBACK));
  });
});
