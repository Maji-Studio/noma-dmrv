// @vitest-environment jsdom
/**
 * A server refusal shows at the field it names, where the form used to copy
 * the server's custody rules (#1298): the delivery not yet delivered, the
 * application dated before its delivery, and an applied mass over what the
 * delivery has left. Locks are covered with the shared hook.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Application } from "@/db/schema/application";
import { ActionError } from "@/lib/action-error";
import type { RecordLockView } from "@/lib/record-lock-view";
import type { ApplicationDeliveryOption } from "./mass-utils";

vi.mock("@/hooks/use-organization-settings", async () => {
  const { DEFAULT_ORGANIZATION_SETTINGS } = await import("@/config/organization-settings");
  return { useOrganizationDefaultValues: () => ({ defaults: DEFAULT_ORGANIZATION_SETTINGS }) };
});
vi.mock("./application-evidence-panel", () => ({ ApplicationEvidencePanel: () => null }));
vi.mock("./application-supporting-evidence-panel", () => ({ ApplicationSupportingEvidencePanel: () => null }));
vi.mock("./field-position-field", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./field-position-field")>()),
  FieldPositionField: () => null,
}));

import { ApplicationForm } from "./application-form";

const DELIVERY: ApplicationDeliveryOption = {
  id: "11111111-1111-4111-8111-111111111111",
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

const APPLICATION = {
  id: "application-1",
  deliveryId: DELIVERY.id,
  applicationDate: new Date("2026-10-02T00:00:00Z"),
  biocharAppliedTons: 0.4,
  biocharAppliedDryTons: 0.18,
  fieldSizeHa: 2,
  fieldIdentifier: "Field 1",
  cropType: "maize",
  applicationMethodType: "manual",
  evidenceMethod: "customer_location",
  gpsLatitude: -8.5,
  gpsLongitude: 35.2,
} as unknown as Application;

const OPEN_LOCK: RecordLockView = { level: "open", heldBy: [], usedBy: [], freeFields: [], howToFree: null, returnedBy: [] };

const refusal = (path: string, message: string) =>
  new ActionError({ error: message, code: "validation_failed", issues: [{ path: [path], code: "validation_failed", message }] });

function renderRefused(error: ActionError) {
  const onSubmit = vi.fn((_data, onRefusal) => {
    expect(onRefusal(error)).toEqual({ footer: null });
  });
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <ApplicationForm application={APPLICATION} lock={OPEN_LOCK} deliveries={[DELIVERY]} onSubmit={onSubmit} />
    </QueryClientProvider>,
  );
  fireEvent.submit(view.container.querySelector("form")!);
  return onSubmit;
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe("ApplicationForm server refusals", () => {
  it("shows a delivery that is not delivered at the delivery field", async () => {
    const message = "Delivery DL-26-001 is not marked as delivered. Mark it as delivered before recording an application.";
    const onSubmit = renderRefused(refusal("deliveryId", message));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect((await screen.findAllByText(message)).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Not saved. Fix 1 field.")).toBeTruthy();
  });

  it("shows a date before the delivery at the application date", async () => {
    const message = "Application date cannot be before the delivery date of DL-26-001";
    const onSubmit = renderRefused(refusal("applicationDate", message));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect((await screen.findAllByText(new RegExp(message))).length).toBeGreaterThanOrEqual(2);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(/Application date/)));
  });

  it("shows an over-draw at the applied mass, renamed from the operation's field", async () => {
    const message = "Only 600 kg remains in this delivery. Reduce the applied mass.";
    const onSubmit = renderRefused(refusal("appliedWetMassKg", message));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect((await screen.findAllByText(new RegExp(message))).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Remaining now/)).toBeTruthy();
  });
});
