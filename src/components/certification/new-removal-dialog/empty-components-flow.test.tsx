// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const BATCH = "batch-1";
const mocks = vi.hoisted(() => ({
  landing: { data: undefined as unknown, isError: false, error: null as unknown, refetch: vi.fn() },
  query: { data: undefined as unknown, isLoading: false, isError: false },
  load: vi.fn(),
  refresh: vi.fn(),
  create: vi.fn(),
  submit: { isPending: false, isSuccess: false },
}));

vi.mock("@/components/ui", () => ({
  Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
  Modal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ error: vi.fn() }) }));
vi.mock("@/hooks/use-certification", () => ({
  useSubmitRemoval: () => ({ ...mocks.submit, reset: vi.fn(), error: null }),
  useSelectableBatches: () => ({ data: { batches: [{ id: BATCH, health: { state: "ready" } }], facilitySetupComplete: true }, isLoading: false, isError: false }),
  useCreateRemovalWithBatches: () => ({ mutate: mocks.create, isPending: false }),
  useRemovalCertifyContext: () => ({ data: { memberBatches: [] }, isLoading: false, error: null }),
}));
vi.mock("@/hooks/use-removal-empty-components", () => ({
  EmptyComponentsCheckError: class EmptyComponentsCheckError extends Error {},
  useRemovalLanding: () => mocks.landing,
  useRemovalEmptyComponents: () => mocks.query,
  useEmptyComponentsActions: () => ({ busy: false, pendingBatchId: null, error: null, errorBatchId: null, recordZeros: vi.fn(), undoZeros: vi.fn() }),
  useLoadRemovalEmptyComponents: () => mocks.load,
  useRefreshRemovalReview: () => mocks.refresh,
}));
vi.mock("@/lib/certification/readiness", () => ({ deriveRemovalReadiness: () => ({ state: "ready" }) }));
vi.mock("@/lib/certification/readiness-facts", () => ({ toRemovalReadinessFacts: () => ({}) }));
vi.mock("./resume-state", () => ({ shouldBlockRemovalResume: () => false }));
vi.mock("./select-batches-step", () => ({ SelectBatchesStep: () => <div>select step</div> }));
vi.mock("./empty-components-step", () => ({
  EmptyComponentsStep: () => <div>empty components step</div>,
  CHECK_FAILED_MESSAGE: "The empty components could not be checked. Try again.",
}));
vi.mock("@/components/ui/notice", () => ({
  Notice: ({ children, action }: { children: ReactNode; action?: ReactNode }) => <div role="alert">{children}{action}</div>,
}));
vi.mock("./submit-step", () => ({ SubmitStep: () => <div>submit step</div> }));

import { NewRemovalDialog } from "./index";
import { EmptyComponentsCheckError } from "@/hooks/use-removal-empty-components";

const OPEN = {
  removalVersion: 1,
  editable: true,
  batches: [{ creditBatchId: BATCH, code: "CB-26-001", lines: [{ componentId: "a" }, { componentId: "b" }], zeros: [] }],
};
const CONFIRMED = {
  removalVersion: 2,
  editable: true,
  batches: [{ creditBatchId: BATCH, code: "CB-26-001", lines: [], zeros: [{ id: "z", componentId: "a" }] }],
};
const LAND_EMPTY = { step: "empty" };
const LAND_SUBMIT = { step: "submit" };

function renderDialog(resumeRemovalId: string | null) {
  return render(
    <NewRemovalDialog facilityId="f" facilityName="Facility" isOpen onClose={vi.fn()} resumeRemovalId={resumeRemovalId} />,
  );
}

afterEach(cleanup);
beforeEach(() => {
  mocks.landing = { data: undefined, isError: false, error: null, refetch: vi.fn() };
  mocks.query = { data: undefined, isLoading: false, isError: false };
  mocks.load.mockReset();
  mocks.refresh.mockReset().mockResolvedValue(undefined);
  mocks.create.mockReset();
  mocks.submit = { isPending: false, isSuccess: false };
});

describe("New Removal wizard with empty components", () => {
  it("lands a reopened draft on the Empty components step while components are unconfirmed", () => {
    mocks.landing.data = LAND_EMPTY;
    mocks.query.data = OPEN;
    renderDialog("removal-1");
    expect(screen.getByText("empty components step")).toBeTruthy();
    expect(screen.getByText("Empty components")).toBeTruthy();
  });

  it("lands a reopened draft with every component confirmed on submit, and keeps the step in the rail for Undo", () => {
    mocks.landing.data = LAND_SUBMIT;
    mocks.query.data = CONFIRMED;
    renderDialog("removal-1");
    expect(screen.getByText("submit step")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Empty components/ })).toBeTruthy();
  });

  it("skips the step entirely when no selected batch has empty components", () => {
    mocks.landing.data = LAND_SUBMIT;
    mocks.query.data = { removalVersion: 1, editable: true, batches: [{ creditBatchId: BATCH, code: "CB-26-001", lines: [], zeros: [] }] };
    renderDialog("removal-1");
    expect(screen.getByText("submit step")).toBeTruthy();
    expect(screen.queryByText("Empty components")).toBeNull();
  });

  it("does not move the operator when the data changes while they are on the step", () => {
    mocks.landing.data = LAND_EMPTY;
    mocks.query.data = OPEN;
    const view = renderDialog("removal-1");
    expect(screen.getByText("empty components step")).toBeTruthy();

    // Recording the last zeros: the read now says everything is confirmed.
    mocks.query.data = CONFIRMED;
    view.rerender(<NewRemovalDialog facilityId="f" facilityName="Facility" isOpen onClose={vi.fn()} resumeRemovalId="removal-1" />);
    expect(screen.getByText("empty components step")).toBeTruthy();
    expect(screen.queryByText("submit step")).toBeNull();
  });

  it("offers a retry when the landing read fails, instead of treating it as nothing empty", () => {
    mocks.landing.isError = true;
    mocks.landing.error = new EmptyComponentsCheckError("x");
    renderDialog("removal-1");
    expect(screen.getByRole("alert").textContent).toContain("The empty components could not be checked. Try again.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mocks.landing.refetch).toHaveBeenCalled();
  });

  it("shows the original message, not the empty components one, when the context itself fails to load", () => {
    mocks.landing.isError = true;
    mocks.landing.error = new Error("context failed");
    renderDialog("removal-1");
    expect(screen.getByRole("alert").textContent).toBe("This Removal could not be loaded. Refresh the page.");
  });

  it("marks no step current while the landing is unresolved", () => {
    renderDialog("removal-1");
    expect(document.querySelector('[aria-current="step"]')).toBeNull();
  });

  it("sends a new Removal to the landing the server picks", () => {
    mocks.landing.data = LAND_EMPTY;
    mocks.query.data = OPEN;
    mocks.create.mockImplementation((_input: unknown, options: { onSuccess: (value: { removalId: string }) => void }) =>
      options.onSuccess({ removalId: "removal-new" }));
    renderDialog(null);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("empty components step")).toBeTruthy();
  });

  it("stays on the step when the fresh read fails, and says it could not check", async () => {
    mocks.landing.data = LAND_EMPTY;
    mocks.query.data = OPEN;
    mocks.load.mockResolvedValue(null);
    renderDialog("removal-1");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Continue" })); });
    expect(screen.getByRole("alert").textContent).toContain("The empty components could not be checked. Try again.");
    expect(screen.getByText("empty components step")).toBeTruthy();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("names what blocks Continue only after a refused press, then proceeds once none is open", async () => {
    mocks.landing.data = LAND_EMPTY;
    mocks.query.data = OPEN;
    mocks.load.mockResolvedValueOnce(OPEN).mockResolvedValueOnce(CONFIRMED);
    renderDialog("removal-1");

    // The cards already count the components: no second line at rest.
    expect(screen.queryByRole("alert")).toBeNull();

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Continue" })); });
    expect(screen.getByRole("alert").textContent).toBe("Record the 2 components with nothing in CB-26-001 as zero, or add entries.");
    expect(screen.getByText("empty components step")).toBeTruthy();
    expect(mocks.refresh).not.toHaveBeenCalled();

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Continue" })); });
    await waitFor(() => expect(screen.getByText("submit step")).toBeTruthy());
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("goes on to submit when the Removal stopped being editable while the operator was on the step", async () => {
    mocks.landing.data = LAND_EMPTY;
    mocks.query.data = OPEN;
    // The fresh read still lists open components, but zeros can no longer change.
    mocks.load.mockResolvedValue({ ...OPEN, editable: false });
    renderDialog("removal-1");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Continue" })); });
    await waitFor(() => expect(screen.getByText("submit step")).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("offers Cancel next to Continue, like the selection step", () => {
    mocks.landing.data = LAND_EMPTY;
    mocks.query.data = OPEN;
    renderDialog("removal-1");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("offers no way back to the step once the Removal is submitted or cannot take zeros", () => {
    mocks.landing.data = LAND_SUBMIT;
    mocks.query.data = CONFIRMED;
    mocks.submit = { isPending: false, isSuccess: true };
    renderDialog("removal-1");
    expect(screen.queryByRole("button", { name: /Empty components/ })).toBeNull();

    cleanup();
    mocks.submit = { isPending: false, isSuccess: false };
    mocks.query.data = { ...CONFIRMED, editable: false };
    renderDialog("removal-1");
    expect(screen.queryByText("Empty components")).toBeNull();
  });
});
