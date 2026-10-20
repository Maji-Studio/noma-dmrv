// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const BATCH = "batch-1";
const mocks = vi.hoisted(() => ({
  query: { data: undefined as unknown, isLoading: false, isError: false },
  load: vi.fn(),
  refresh: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@/components/ui", () => ({
  Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
  Modal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ error: vi.fn() }) }));
vi.mock("@/hooks/use-certification", () => ({
  useSubmitRemoval: () => ({ isPending: false, reset: vi.fn(), error: null }),
  useSelectableBatches: () => ({ data: { batches: [{ id: BATCH, health: { state: "ready" } }], facilitySetupComplete: true }, isLoading: false, isError: false }),
  useCreateRemovalWithBatches: () => ({ mutate: mocks.create, isPending: false }),
  useRemovalCertifyContext: () => ({ data: { memberBatches: [] }, isLoading: false, error: null }),
}));
vi.mock("@/hooks/use-removal-empty-components", () => ({
  useRemovalEmptyComponents: () => mocks.query,
  useLoadRemovalEmptyComponents: () => mocks.load,
  useRefreshRemovalReview: () => mocks.refresh,
}));
vi.mock("@/lib/certification/readiness", () => ({ deriveRemovalReadiness: () => ({ state: "ready" }) }));
vi.mock("@/lib/certification/readiness-facts", () => ({ toRemovalReadinessFacts: () => ({}) }));
vi.mock("./resume-state", () => ({ shouldBlockRemovalResume: () => false }));
vi.mock("./select-batches-step", () => ({ SelectBatchesStep: () => <div>select step</div> }));
vi.mock("./empty-components-step", () => ({ EmptyComponentsStep: () => <div>empty components step</div> }));
vi.mock("./submit-step", () => ({ SubmitStep: () => <div>submit step</div> }));

import { NewRemovalDialog } from "./index";

const OPEN = {
  removalVersion: 1,
  batches: [{ creditBatchId: BATCH, code: "CB-26-001", lines: [{ componentId: "a" }, { componentId: "b" }], zeros: [] }],
};
const CONFIRMED = {
  removalVersion: 2,
  batches: [{ creditBatchId: BATCH, code: "CB-26-001", lines: [], zeros: [{ id: "z", componentId: "a" }] }],
};
const NOTHING = { removalVersion: 1, batches: [{ creditBatchId: BATCH, code: "CB-26-001", lines: [], zeros: [] }] };

function renderDialog(resumeRemovalId: string | null) {
  return render(
    <NewRemovalDialog facilityId="f" facilityName="Facility" isOpen onClose={vi.fn()} resumeRemovalId={resumeRemovalId} />,
  );
}

afterEach(cleanup);
beforeEach(() => {
  mocks.query = { data: undefined, isLoading: false, isError: false };
  mocks.load.mockReset();
  mocks.refresh.mockReset().mockResolvedValue(undefined);
  mocks.create.mockReset();
});

describe("New Removal wizard with empty components", () => {
  it("lands a reopened draft on the Empty components step while components are unconfirmed", () => {
    mocks.query = { data: OPEN, isLoading: false, isError: false };
    renderDialog("removal-1");
    expect(screen.getByText("empty components step")).toBeTruthy();
    expect(screen.getByText("Empty components")).toBeTruthy();
  });

  it("lands a reopened draft with every component confirmed on the submit step", () => {
    mocks.query = { data: CONFIRMED, isLoading: false, isError: false };
    renderDialog("removal-1");
    expect(screen.getByText("submit step")).toBeTruthy();
    // The rail still offers the step, so a recorded zero can be undone.
    expect(screen.getByRole("button", { name: /Empty components/ })).toBeTruthy();
  });

  it("skips the step entirely when no selected batch has empty components", () => {
    mocks.query = { data: NOTHING, isLoading: false, isError: false };
    renderDialog("removal-1");
    expect(screen.getByText("submit step")).toBeTruthy();
    expect(screen.queryByText("Empty components")).toBeNull();
  });

  it("sends a new Removal to the step when its batch has empty components, and past it when not", async () => {
    for (const [answer, expected] of [[OPEN, "empty components step"], [NOTHING, "submit step"]] as const) {
      cleanup();
      mocks.load.mockResolvedValue(answer);
      mocks.create.mockImplementation((_input: unknown, options: { onSuccess: (value: { removalId: string }) => Promise<void> }) =>
        options.onSuccess({ removalId: "removal-new" }));
      renderDialog(null);
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      await waitFor(() => expect(screen.getByText(expected)).toBeTruthy());
    }
  });

  it("refuses Continue with the reason while a component is unconfirmed, then proceeds once none is", async () => {
    mocks.query = { data: OPEN, isLoading: false, isError: false };
    mocks.load.mockResolvedValueOnce(OPEN).mockResolvedValueOnce(CONFIRMED);
    renderDialog("removal-1");

    // The reason sits next to the action before it is pressed.
    expect(screen.getByText("Record the 2 components with nothing in CB-26-001 as zero, or add entries.")).toBeTruthy();

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Continue" })); });
    expect(screen.getByRole("alert").textContent).toContain("Record the 2 components");
    expect(screen.getByText("empty components step")).toBeTruthy();
    expect(mocks.refresh).not.toHaveBeenCalled();

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Continue" })); });
    await waitFor(() => expect(screen.getByText("submit step")).toBeTruthy());
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});
