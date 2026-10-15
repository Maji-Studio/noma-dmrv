// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreditBatchRemovalTemplate } from "./credit-batch-removal-template";

const mocks = vi.hoisted(() => ({ pin: "rvt_new" as string | null }));
vi.mock("@/hooks/use-credit-batches", () => ({
  useCreditBatch: () => ({ data: undefined, refetch: vi.fn() }),
}));
vi.mock("@/hooks/use-certification", () => ({
  useFacilityCertifierSummary: () => ({
    data: { mapping: { externalProjectId: "prj_test", defaultRemovalTemplateId: "rvt_new" } },
    isLoading: false, isSuccess: true,
  }),
  useIsometricProjectTemplates: () => ({
    data: [{ id: "rvt_new", display_name: "Dark Earth Carbon Template", credit_type: "REMOVAL" }],
    isLoading: false, isSuccess: true, isError: false, error: null,
  }),
}));
vi.mock("./credit-batch-template-switch-dialog", () => ({ CreditBatchTemplateSwitchDialog: () => null }));

function mount(canManage: boolean, locked = false) {
  render(
    <CreditBatchRemovalTemplate
      creditBatch={{ id: "batch-1", code: "CB-26-001", facilityId: "facility-1", version: 2, removalTemplateId: mocks.pin }}
      canManage={canManage}
      locked={locked}
    />,
  );
}

beforeEach(() => { mocks.pin = "rvt_new"; });
afterEach(cleanup);

describe("CreditBatchRemovalTemplate", () => {
  it("names the pinned template and offers Switch template to Owners and Admins", () => {
    mount(true);
    expect(screen.getByText("Dark Earth Carbon Template")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Switch template" })).toBeTruthy();
  });

  it("is read-only for members and while a Removal locks the batch", () => {
    mount(false);
    expect(screen.queryByRole("button", { name: "Switch template" })).toBeNull();
    cleanup();
    mount(true, true);
    expect(screen.queryByRole("button", { name: "Switch template" })).toBeNull();
  });

  it("says an unpinned batch has no template and who can choose one", () => {
    mocks.pin = null;
    mount(false);
    expect(screen.getByText("Not set")).toBeTruthy();
    expect(screen.getByText("This credit batch has no Removal template. Ask an Owner or Admin to choose one.")).toBeTruthy();
  });
});
