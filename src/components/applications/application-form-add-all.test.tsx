// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Application } from "@/db/schema/application";
import type { RecordLockView } from "@/lib/record-lock-view";
import type { ApplicationDeliveryOption } from "./mass-utils";

vi.mock("@/hooks/use-organization-settings", async () => {
  const { DEFAULT_ORGANIZATION_SETTINGS } = await import(
    "@/config/organization-settings"
  );
  return {
    useOrganizationDefaultValues: () => ({
      defaults: DEFAULT_ORGANIZATION_SETTINGS,
    }),
  };
});
vi.mock("./application-evidence-panel", () => ({
  ApplicationEvidencePanel: () => null,
}));
vi.mock("./application-supporting-evidence-panel", () => ({
  ApplicationSupportingEvidencePanel: () => null,
}));
vi.mock("./field-position-field", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./field-position-field")>()),
  FieldPositionField: () => null,
}));

import { ApplicationForm } from "./application-form";

const DELIVERY: ApplicationDeliveryOption = {
  id: "delivery-1",
  code: "DL-26-001",
  status: "delivered",
  deliveryDate: "2026-09-22",
  orderCode: "OR-26-001",
  formulationName: "Chicken manure 50/50",
  productBinName: "BCF",
  massDryKg: 450,
  deliveredWetMassKg: 1_000,
  orderQuantityKg: 1_000,
  moistureContentPercent: 55,
  defaultSoilTemperatureC: null,
  facilityDefaultSoilTemperatureC: null,
  destinationGpsLatitude: null,
  destinationGpsLongitude: null,
  alreadyAppliedWetKg: 400,
  alreadyAppliedDryKg: 180,
};

const EDITED_APPLICATION = {
  id: "application-1",
  deliveryId: DELIVERY.id,
  applicationDate: new Date("2026-10-02T00:00:00Z"),
  biocharAppliedTons: 0.4,
  biocharAppliedDryTons: 0.18,
  fieldSizeHa: 2,
  fieldIdentifier: "Field 1",
  cropType: "maize",
  evidenceMethod: "customer_location",
} as unknown as Application;

const OPEN_LOCK: RecordLockView = {
  level: "open",
  heldBy: [],
  usedBy: [],
  freeFields: [],
  howToFree: null,
  returnedBy: [],
};

function renderForm({
  application,
  delivery = DELIVERY,
}: { application?: Application; delivery?: ApplicationDeliveryOption } = {}) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ApplicationForm
        application={application}
        lock={application ? OPEN_LOCK : undefined}
        deliveries={[delivery]}
        onSubmit={() => undefined}
      />
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe("ApplicationForm Add all", () => {
  it("fills the applied mass with what the delivery has left", async () => {
    renderForm({ application: EDITED_APPLICATION });
    const input = screen.getByRole("spinbutton", { name: /Biochar product applied/ }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "100" } });

    fireEvent.click(screen.getByRole("button", { name: "Add all" }));

    // Edit mode adds this application's own 400 kg back: 1,000 - 400 + 400.
    expect(await screen.findByDisplayValue("1000")).toBe(input);
  });

  it("is hidden when nothing is available", () => {
    renderForm({
      application: EDITED_APPLICATION,
      delivery: { ...DELIVERY, alreadyAppliedWetKg: 1_400 },
    });

    expect(screen.queryByRole("button", { name: "Add all" })).toBeNull();
  });

  it("is hidden when no delivery is selected", () => {
    renderForm();

    expect(screen.queryByRole("button", { name: "Add all" })).toBeNull();
  });
});
