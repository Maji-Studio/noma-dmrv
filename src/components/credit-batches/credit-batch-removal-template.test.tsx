// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REMOVAL_TEMPLATE_LANDING_LINE } from "@/lib/certification/removal-template-blockers";
import { CreditBatchRemovalTemplate } from "./credit-batch-removal-template";

const mocks = vi.hoisted(() => ({ pin: "rvt_new" as string | null, listed: ["rvt_new"] as string[] }));
vi.mock("@/hooks/use-credit-batches", () => ({
  useCreditBatch: () => ({ data: undefined, refetch: vi.fn() }),
}));
vi.mock("@/hooks/use-certification", () => ({
  useFacilityCertifierSummary: () => ({
    data: { mapping: { externalProjectId: "prj_test", defaultRemovalTemplateId: "rvt_new" } },
    isLoading: false, isSuccess: true,
  }),
  useIsometricProjectTemplates: () => ({
    data: mocks.listed.map((id) => ({ id, display_name: "Dark Earth Carbon Template", credit_type: "REMOVAL" })),
    isLoading: false, isSuccess: true, isError: false, error: null,
  }),
}));
vi.mock("./credit-batch-template-switch-dialog", () => ({ CreditBatchTemplateSwitchDialog: () => null }));

function mount(canManage: boolean, locked = false, activeFocusTarget?: string) {
  render(
    <CreditBatchRemovalTemplate
      creditBatch={{ id: "batch-1", code: "CB-26-001", facilityId: "facility-1", version: 2, removalTemplateId: mocks.pin }}
      canManage={canManage}
      locked={locked}
      activeFocusTarget={activeFocusTarget}
    />,
  );
}

/** The focus callout line (the Notices are statuses too, so match the paragraph). */
const landingLine = () => document.querySelector("p[role='status']");

beforeEach(() => {
  mocks.pin = "rvt_new";
  mocks.listed = ["rvt_new"];
  Element.prototype.scrollIntoView = vi.fn();
});
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
    mount(true);
    expect(screen.getByRole("button", { name: "Set template" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Switch template" })).toBeNull();
    cleanup();
    mount(false);
    expect(screen.getByText("Not set")).toBeTruthy();
    expect(screen.getByText("This credit batch has no Removal template. Ask an Owner or Admin to choose one.")).toBeTruthy();
  });

  describe("opened by a readiness blocker link", () => {
    const FOCUS = "removal-template";
    const UNPINNED_COPY = "Choose a Removal template for this credit batch before adding it to a Removal.";
    const MISSING_COPY = "Template no longer exists in Isometric. Switch to another Removal template.";

    it("says an unpinned batch needs a template once", () => {
      mocks.pin = null;
      mount(true, false, FOCUS);
      expect(screen.getAllByText(/Choose a Removal template/)).toHaveLength(1);
      expect(screen.getByText(UNPINNED_COPY)).toBeTruthy();
      expect(landingLine()).toBeNull();
    });

    it("lands on the not-found notice, not on a request to choose a template", () => {
      mocks.listed = [];
      mount(true, false, FOCUS);
      expect(screen.getAllByText(/Template no longer exists/)).toHaveLength(1);
      expect(screen.getByText(MISSING_COPY)).toBeTruthy();
      expect(screen.queryByText(/Choose a Removal template/)).toBeNull();
      expect(landingLine()).toBeNull();
    });

    it("shows one neutral line when the pin is listed and a blocker still sent the operator here", () => {
      mount(true, false, FOCUS);
      expect(landingLine()?.textContent).toBe(REMOVAL_TEMPLATE_LANDING_LINE);
      expect(screen.queryByText(/Choose a Removal template/)).toBeNull();
    });

    it("shows no landing line when the sheet was not opened by the link", () => {
      mount(true);
      expect(landingLine()).toBeNull();
    });
  });
});
