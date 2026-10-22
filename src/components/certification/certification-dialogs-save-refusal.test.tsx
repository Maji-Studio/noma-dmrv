// @vitest-environment jsdom
/**
 * The certification dialogs hand a failed save to `useSaveRefusal` (#1327): a
 * refusal that names a field shown in the dialog lands at that field with no
 * footer; registry failures name no field and keep their exact text in the
 * footer. The paths below are form contract cases (the field names the schemas
 * validate), not recorded server responses.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/action-error";

const mocks = vi.hoisted(() => ({
  recordPrerequisites: vi.fn(),
  saveMapping: vi.fn(),
  createStatement: vi.fn(),
  prepareReport: vi.fn(),
  submitToVerifier: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/hooks/use-production-processes", () => ({
  useRecordMethodBPrerequisites: () => ({ mutateAsync: mocks.recordPrerequisites, isPending: false }),
}));
vi.mock("@/hooks/use-certification", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-certification")>()),
  useSaveFacilityCertifierMapping: () => ({ mutateAsync: mocks.saveMapping, isPending: false }),
  useCreateGhgStatement: () => ({ mutateAsync: mocks.createStatement, isPending: false, data: undefined }),
  useGhgStatementsForFacility: () => ({ isSuccess: true, data: [] }),
  useRegistryGhgStatementsForFacility: () => ({ data: [], isLoading: false, error: null }),
  useOpenRemovalsForFacility: () => ({ data: [{ id: "rmv_1", completedOn: "2026-07-15" }], isLoading: false, error: null }),
  useSubmitGhgStatementToVerifier: () => ({
    mutateAsync: mocks.submitToVerifier, isPending: false, isError: false, isSuccess: false, error: null, data: undefined, reset: vi.fn(),
  }),
  usePrepareGhgStatementReport: () => ({ mutateAsync: mocks.prepareReport, isPending: false }),
  useApproveGhgStatementReport: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useGhgStatementBreakdown: () => ({ data: { status: "available" }, isLoading: false }),
}));
vi.mock("@/components/forms/entity-select/entity-select", () => ({
  EntitySelect: ({ id, value }: { id: string; value?: string }) => (
    <button type="button" id={id} role="combobox" aria-controls={`${id}-options`} aria-expanded={false}>{value}</button>
  ),
}));
vi.mock("./removal-batches-accordion", () => ({ RemovalBatchesAccordion: () => null }));
vi.mock("./ghg-statement-carbon-breakdown", () => ({ GhgStatementCarbonBreakdown: () => null }));

import { MethodBPrerequisitesSetup } from "@/components/credit-batches/method-b-prerequisites-setup";
import { FacilityCertifierForm } from "./facility-certifier-dialog";
import { GhgStatementCreateDialog } from "./ghg-statement-create-dialog";
import { GhgStatementSubmitDialog } from "./ghg-statement-submit-dialog";

const FACILITY_ID = "11111111-1111-4111-8111-111111111111";

const refusal = (path: string, message: string) =>
  new ActionError({ error: message, code: "validation_failed", issues: [{ path: [path], code: "validation_failed", message }] });

/**
 * The message sits once, in the field's own error line (not the dialog's
 * footer box): `FormField` gives that line the id `<field id>-error`, and the
 * production checkbox's `FormError` has none, so it is told by its role.
 */
async function expectAtField(message: string, errorId?: string) {
  const hits = await screen.findAllByText(message);
  expect(hits).toHaveLength(1);
  const line = hits[0]!;
  expect(line.getAttribute("role")).toBe("alert");
  expect(line.className).toContain("body-caption");
  if (errorId) expect(line.id).toBe(errorId);
}

const wrap = (node: React.ReactNode) => <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>;

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Object.values(mocks).forEach((mock) => mock.mockReset());
});
afterEach(cleanup);

describe("MethodBPrerequisitesSetup refusals", () => {
  const open = async () => {
    render(wrap(<MethodBPrerequisitesSetup processId="22222222-2222-4222-8222-222222222222" agreedBaselineSize={30} />));
    fireEvent.click(screen.getByText("Set up Method-B prerequisites"));
    fireEvent.change(await screen.findByPlaceholderText(/sampling plan/), { target: { value: "PDD 8.3" } });
  };

  it("sends one request when the form is submitted twice at once", async () => {
    let finish: (value?: unknown) => void = () => undefined;
    mocks.recordPrerequisites.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await open();
    const form = document.querySelector("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(mocks.recordPrerequisites).toHaveBeenCalledTimes(1));
    finish();
    expect(mocks.recordPrerequisites).toHaveBeenCalledTimes(1);
  });

  it("shows a refused baseline size at its field with no footer", async () => {
    const message = "Agreed baseline size is below the Method-A samples on record.";
    mocks.recordPrerequisites.mockRejectedValue(refusal("agreedBaselineSize", message));
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Record prerequisites" }));
    await expectAtField(message, "method-b-agreed-baseline-error");
    // The error summary links to the field and focus moves into the dialog.
    expect(screen.getByText("Not saved. Fix 1 field.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Agreed baseline size/ })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById("method-b-agreed-baseline")));
  });

  it("keeps the server's text in the footer when no field is named", async () => {
    mocks.recordPrerequisites.mockRejectedValue(new Error("Registry is unavailable."));
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Record prerequisites" }));
    expect(await screen.findByText("Registry is unavailable.")).toBeTruthy();
  });
});

describe("FacilityCertifierForm refusals", () => {
  const renderForm = (isProduction = false) =>
    render(
      <FacilityCertifierForm
        facilityId={FACILITY_ID}
        presentation="inline"
        loaderData={{
          mapping: {
            externalProjectId: "prj_test", protocolSlug: "biochar", externalFacilityId: "fcl_old",
          },
          availableProjects: [{ id: "prj_test", name: "Test project" }],
          linkHints: [],
          isProduction,
        } as never}
      />,
    );

  it("shows a refused facility ID at its field with no footer", async () => {
    // The shape saveFacilityCertifierMapping returns when another facility owns the ID.
    const message = "Isometric facility ID fcl_old is already linked to FAC-2: North. Each Isometric facility maps to one noma facility.";
    mocks.saveMapping.mockRejectedValue(refusal("externalFacilityId", message));
    const view = renderForm();
    fireEvent.submit(view.container.querySelector("form")!);
    await expectAtField(message, "externalFacilityId-error");
  });

  it("shows the production confirmation refusal under the checkbox", async () => {
    // The shape saveFacilityCertifierMapping returns when the box is not ticked in production.
    const message = "Confirm you want to save against the production Isometric environment.";
    mocks.saveMapping.mockRejectedValue(refusal("confirmProduction", message));
    const view = renderForm(true);
    fireEvent.submit(view.container.querySelector("form")!);
    await expectAtField(message);
  });

  it("keeps a registry failure in the footer with its exact text", async () => {
    mocks.saveMapping.mockRejectedValue(new Error("Isometric did not respond."));
    const view = renderForm();
    fireEvent.submit(view.container.querySelector("form")!);
    expect(await screen.findByText("Isometric did not respond.")).toBeTruthy();
  });
});

describe("GhgStatementCreateDialog refusals", () => {
  const toLastStep = async () => {
    render(wrap(<GhgStatementCreateDialog facilityId={FACILITY_ID} isProduction open onClose={vi.fn()} />));
    await screen.findByText("New GHG Statement");
    fireEvent.change(document.getElementById("reportingPeriodEndOn")!, { target: { value: "2026-07-31" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("button", { name: "Create GHG Statement" });
    fireEvent.click(screen.getByRole("checkbox"));
  };

  it("shows a refused production confirmation at its checkbox with no footer", async () => {
    const message = "Production creation needs a confirmed registry environment.";
    mocks.createStatement.mockRejectedValue(refusal("confirmProduction", message));
    await toLastStep();
    fireEvent.click(screen.getByRole("button", { name: "Create GHG Statement" }));
    await expectAtField(message);
  });

  it("keeps a refusal about a field on another step in the footer", async () => {
    const message = "A statement already ends 2026-07-31. Choose a later date.";
    mocks.createStatement.mockRejectedValue(refusal("reportingPeriodEndOn", message));
    await toLastStep();
    fireEvent.click(screen.getByRole("button", { name: "Create GHG Statement" }));
    // No such field on this step, so the dialog's footer carries the reason.
    // The server error box splits a message into title and detail.
    expect(await screen.findByText("A statement already ends 2026-07-31.")).toBeTruthy();
    expect(document.getElementById("reportingPeriodEndOn")).toBeNull();
  });
});

describe("GhgStatementSubmitDialog refusals", () => {
  const renderDialog = () =>
    render(
      wrap(
        <GhgStatementSubmitDialog
          ghgStatementId="33333333-3333-4333-8333-333333333333"
          isOpen
          onClose={vi.fn()}
          isProduction
          isResubmit={false}
          canGenerate
        />,
      ),
    );

  it("shows a refused production confirmation at its checkbox with no footer", async () => {
    const message = "Confirm the production submission.";
    mocks.prepareReport.mockRejectedValue(refusal("confirmProduction", message));
    renderDialog();
    fireEvent.click(await screen.findByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await expectAtField(message);
    // This dialog has no error summary, so nothing is listed or focused; the
    // message under the checkbox is the whole signal.
    expect(screen.queryByText("Not saved. Fix 1 field.")).toBeNull();
  });

  it("keeps a registry failure in the footer with its exact text", async () => {
    mocks.prepareReport.mockRejectedValue(new Error("Isometric rejected the report."));
    renderDialog();
    fireEvent.click(await screen.findByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findAllByText("Isometric rejected the report.")).toHaveLength(1);
  });
});
