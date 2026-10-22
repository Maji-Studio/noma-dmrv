// @vitest-environment jsdom
/**
 * A server refusal shows at the field it names, where the form used to copy
 * the server's custody rules (#1298): the delivery not yet delivered, the
 * application dated before its delivery, and an applied mass over what the
 * delivery has left. Locks are covered with the shared hook.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const LOCK_REASON = "This application is in a Removal sent to Isometric. Correct the Removal first."
const lockRefusal = (path: string) =>
  new ActionError({ error: LOCK_REASON, code: "certification_locked", issues: [{ path: [path], code: "certification_locked", message: LOCK_REASON }] });

function renderRefused(error: ActionError, { footer = null as string | null, edit = () => {} } = {}) {
  const onSubmit = vi.fn((_data, onRefusal) => {
    expect(onRefusal(error, "Application was not saved. Try again.")).toBe(footer);
  });
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <ApplicationForm application={APPLICATION} lock={OPEN_LOCK} deliveries={[DELIVERY]} onSubmit={onSubmit} />
    </QueryClientProvider>,
  );
  edit();
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
    // The reason shows once, at the field; the summary link names the field only.
    expect(await screen.findAllByText(message)).toHaveLength(1);
    expect(screen.getByText("Not saved. Fix 1 field.")).toBeTruthy();
  });

  it("shows a date before the delivery at the application date", async () => {
    const message = "Application date cannot be before the delivery date of DL-26-001 (Sep 22, 2026). Choose that day or a later one.";
    const onSubmit = renderRefused(refusal("applicationDate", message));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    // The reason shows once, at the field; the summary link names the field only.
    expect(await screen.findAllByText(message)).toHaveLength(1);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(/Application date/)));
  });

  it("shows an over-draw at the applied mass, renamed from the operation's field", async () => {
    const message = "Only 600 kg remains in this delivery. Reduce the applied mass.";
    const onSubmit = renderRefused(refusal("appliedWetMassKg", message));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(await screen.findAllByText(new RegExp(message))).toHaveLength(1);
    expect(screen.getByText(/Remaining now/)).toBeTruthy();
  });

  it("marks a changed field that became locked and gives the reason once", async () => {
    const onSubmit = renderRefused(lockRefusal("fieldSizeHa"), {
      footer: LOCK_REASON,
      edit: () => fireEvent.change(screen.getByLabelText(/Field size/), { target: { value: "3" } }),
    });
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(await screen.findAllByText("Not saved. 1 field is locked.")).toHaveLength(2);
    expect(screen.getAllByText("Locked. Your change was not saved.").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(LOCK_REASON)).toBeNull();
    expect((screen.getByLabelText(/Field size/) as HTMLInputElement).value).toBe("2");
  });

  it("leaves a whole-record lock on the unchanged delivery to the footer", async () => {
    const onSubmit = renderRefused(lockRefusal("deliveryId"), { footer: LOCK_REASON });
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(screen.queryByText("Locked. Your change was not saved.")).toBeNull();
    expect(screen.queryByText(/Not saved\./)).toBeNull();
  });
});

vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({ facilityId: "facility-1" }),
  useFacilityClock: () => ({ timeZone: "UTC", hint: "" }),
}));

it("restores the committed baseline after an update whose attachment upload failed", async () => {
  const client = new QueryClient();
  let saved = APPLICATION;
  const onSubmit = vi.fn();
  const form = () => <QueryClientProvider client={client}><ApplicationForm application={saved} lock={OPEN_LOCK} deliveries={[DELIVERY]} onSubmit={onSubmit} errorMessage="Application updated, but 1 attachment failed to upload." /></QueryClientProvider>;
  const view = render(form());
  const size = () => screen.getByLabelText(/Field size/) as HTMLInputElement;
  fireEvent.change(size(), { target: { value: "3" } });
  fireEvent.submit(view.container.querySelector("form")!);
  await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
  // The partial-save handler explicitly advances the baseline while the
  // failed upload keeps this same form mounted. Preserve later typed input too.
  saved = { ...APPLICATION, fieldSizeHa: 3, version: 2 };
  fireEvent.change(size(), { target: { value: "3.5" } });
  act(() => onSubmit.mock.calls[0][2](saved));
  view.rerender(form());
  expect(size().value).toBe("3.5");
  onSubmit.mockImplementation((_data, onRefusal) => onRefusal(lockRefusal("fieldSizeHa"), LOCK_REASON));
  // No further typing: the value typed during upload must remain dirty.
  fireEvent.submit(view.container.querySelector("form")!);
  await waitFor(() => expect(screen.getByText("Locked. Your change was not saved.")).toBeTruthy());
  expect(size().value).toBe("3");
});


it("keeps typed input when the same application is refetched while editing", () => {
  const client = new QueryClient();
  const form = (application: Application) => (
    <QueryClientProvider client={client}>
      <ApplicationForm application={application} lock={OPEN_LOCK} deliveries={[DELIVERY]} onSubmit={vi.fn()} />
    </QueryClientProvider>
  );
  const view = render(form(APPLICATION));
  const size = () => screen.getByLabelText(/Field size/) as HTMLInputElement;
  fireEvent.change(size(), { target: { value: "4" } });
  view.rerender(form({ ...APPLICATION, fieldSizeHa: 3, version: 2 }));
  expect(size().value).toBe("4");
});

it("scrolls to the partial-save message again after a second committed update", async () => {
  const client = new QueryClient();
  const message = "Application updated, but 1 attachment failed to upload.";
  const onSubmit = vi.fn((_data, _onRefusal, onCommitted) => onCommitted(APPLICATION));
  const view = render(<QueryClientProvider client={client}><ApplicationForm application={APPLICATION} lock={OPEN_LOCK} deliveries={[DELIVERY]} onSubmit={onSubmit} errorMessage={message} /></QueryClientProvider>);
  for (const attempt of [1, 2]) {
    vi.mocked(Element.prototype.scrollIntoView).mockClear();
    fireEvent.submit(view.container.querySelector("form")!);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(attempt));
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
    expect(screen.getByText(message)).toBeTruthy();
  }
});
