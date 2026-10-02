import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Application } from "@/db/schema/application";
import { deliveryStockOverdrawMessage } from "@/lib/stock-overdraw";
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

function application(appliedKg: number): Application {
  return {
    id: "application-1",
    deliveryId: DELIVERY.id,
    applicationDate: new Date("2026-10-02T00:00:00Z"),
    biocharAppliedTons: appliedKg / 1_000,
    biocharAppliedDryTons: 0.18,
    fieldSizeHa: 2,
    fieldIdentifier: "Field 1",
    cropType: "maize",
    evidenceMethod: "customer_location",
  } as unknown as Application;
}

function render({
  appliedKg = 400,
  alreadyAppliedWetKg = DELIVERY.alreadyAppliedWetKg,
  errorMessage,
}: {
  appliedKg?: number;
  alreadyAppliedWetKg?: number;
  errorMessage?: string;
} = {}): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <ApplicationForm
        application={application(appliedKg)}
        deliveries={[{ ...DELIVERY, alreadyAppliedWetKg }]}
        onSubmit={() => undefined}
        errorMessage={errorMessage}
      />
    </QueryClientProvider>,
  );
}

describe("ApplicationForm stock figure", () => {
  it("shows one figure: what is available to this application", () => {
    const html = render();

    expect(html).toContain("1,000 kg available to this application");
    expect(html).not.toContain("Remaining now");
  });

  it("shows the delivery's remaining stock when a mass error replaces the cue", () => {
    const html = render({ errorMessage: deliveryStockOverdrawMessage() });

    expect(html).toContain(deliveryStockOverdrawMessage());
    expect(html).not.toContain("available to this application");
    expect(html).toContain("Remaining now: 600 kg wet, 270 kg dry biochar");
  });

  it("keeps one figure when the over-draw error states what is available", () => {
    // Another application already took the rest: 1,000 − 1,400 + 400 = 0 kg.
    const html = render({ alreadyAppliedWetKg: 1_400 });

    expect(html).toContain("Only 0 kg remains in this delivery.");
    expect(html).not.toContain("Remaining now");
  });
});
