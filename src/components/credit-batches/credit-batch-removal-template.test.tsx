// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REMOVAL_TEMPLATE_LANDING_LINE } from "@/lib/certification/removal-template-blockers";
import { CreditBatchRemovalTemplate } from "./credit-batch-removal-template";

const mocks = vi.hoisted(() => ({ pin: "rvt_new" as string | null, listed: ["rvt_new"] as string[], linesToDecide: 0, facilityTemplate: "rvt_new" as string | null }));
vi.mock("@/hooks/use-credit-batches", () => ({
  useCreditBatch: () => ({ data: undefined, refetch: vi.fn() }),
}));
vi.mock("@/hooks/use-certification", () => ({
  useFacilityCertifierSummary: () => ({
    data: { mapping: { externalProjectId: "prj_test", removalTemplateId: mocks.facilityTemplate } },
    isLoading: false, isSuccess: true,
  }),
  useIsometricProjectTemplates: () => ({
    data: mocks.listed.map((id) => ({ id, display_name: "Dark Earth Carbon Template", credit_type: "REMOVAL" })),
    isLoading: false, isSuccess: true, isError: false, error: null,
  }),
}));

function mount(canManage: boolean, locked = false, activeFocusTarget?: string, inRemoval = false, readOnly = false) {
  render(
    <CreditBatchRemovalTemplate
      creditBatch={{ id: "batch-1", code: "CB-26-001", facilityId: "facility-1", version: 2, removalTemplateId: mocks.pin }}
      canManage={canManage}
      locked={locked}
      activeFocusTarget={activeFocusTarget}
      linesToDecide={mocks.linesToDecide}
      inRemoval={inRemoval}
      readOnly={readOnly}
    />,
  );
}

/** The focus callout line (the Notices are statuses too, so match the paragraph). */
const landingLine = () => document.querySelector("p[role='status']");

beforeEach(() => {
  mocks.pin = "rvt_new";
  mocks.listed = ["rvt_new"];
  mocks.linesToDecide = 0;
  mocks.facilityTemplate = "rvt_new";
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe("CreditBatchRemovalTemplate", () => {
  it("names the template read-only and links Admins to the setup in Settings", () => {
    mount(true);
    expect(screen.getByText("Dark Earth Carbon Template")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("link", { name: "Change in Settings" }).getAttribute("href")).toBe("/settings/removal-templates?facility=facility-1&setup=template");
  });

  it("is read-only for members and while a Removal locks the batch", () => {
    mount(false);
    expect(screen.queryByRole("link", { name: "Change in Settings" })).toBeNull();
    cleanup();
    mount(true, true);
    expect(screen.queryByRole("link", { name: "Change in Settings" })).toBeNull();
  });

  it("says an unset batch has no template and who can set one", () => {
    mocks.pin = null;
    mount(true);
    expect(screen.getByRole("link", { name: "Change in Settings" })).toBeTruthy();
    expect(screen.getByText("Set a Removal template in Settings before adding this credit batch to a Removal.")).toBeTruthy();
    cleanup();
    mount(false);
    expect(screen.getByText("Not set")).toBeTruthy();
    expect(screen.getByText("This credit batch has no Removal template. Ask an Admin to set one.")).toBeTruthy();
  });

  describe("while the template has components to decide", () => {
    const LEAD = "17 components to decide, so this credit batch can't go into a Removal.";

    it("tells a member who decides them, with no link", () => {
      mocks.linesToDecide = 17;
      mount(false);
      expect(screen.getByText(`${LEAD} An Admin answers them in Settings, Removal templates.`)).toBeTruthy();
      expect(screen.queryByRole("link", { name: "Answer in Settings" })).toBeNull();
    });

    it("gives Admins an Answer in Settings link to the Check step with this template picked", () => {
      mocks.linesToDecide = 17;
      mount(true);
      expect(screen.getByText(LEAD)).toBeTruthy();
      expect(screen.getByRole("link", { name: "Answer in Settings" }).getAttribute("href")).toBe(
        "/settings/removal-templates?facility=facility-1&setup=check&template=rvt_new",
      );
    });

    it("shows plain text, no Answer link, when the batch was kept on an older template than the facility's", () => {
      mocks.linesToDecide = 3;
      mocks.facilityTemplate = "rvt_other";
      mount(true);
      expect(screen.getByText("3 components to decide, so this credit batch can't go into a Removal.")).toBeTruthy();
      expect(screen.queryByRole("link", { name: "Answer in Settings" })).toBeNull();
    });

    it("says another Removal once a Removal holds the batch", () => {
      mocks.linesToDecide = 1;
      mount(false, true, undefined, true);
      expect(screen.getByText("1 component to decide, so this credit batch can't go into another Removal. An Admin answers it in Settings, Removal templates.")).toBeTruthy();
      cleanup();
      mocks.linesToDecide = 17;
      mount(true, false, undefined, true);
      expect(screen.getByText("17 components to decide, so this credit batch can't go into another Removal.")).toBeTruthy();
    });

    it("says nothing when every component is decided or the pin is gone", () => {
      mount(true);
      expect(screen.queryByText(/components? to decide/)).toBeNull();
      cleanup();
      mocks.linesToDecide = 17;
      mocks.listed = [];
      mount(true);
      expect(screen.queryByText(/components? to decide/)).toBeNull();
    });
  });

  describe("opened by a readiness blocker link", () => {
    const FOCUS = "removal-template";
    const UNPINNED_COPY = "Set a Removal template in Settings before adding this credit batch to a Removal.";
    const MISSING_COPY = "Template no longer exists in Isometric. Choose another Removal template in Settings.";

    it("says an unpinned batch needs a template once", () => {
      mocks.pin = null;
      mount(true, false, FOCUS);
      expect(screen.getAllByText(/Set a Removal template/)).toHaveLength(1);
      expect(screen.getByText(UNPINNED_COPY)).toBeTruthy();
      expect(landingLine()).toBeNull();
    });

    it("lands on the not-found notice, not on a request to choose a template", () => {
      mocks.listed = [];
      mount(true, false, FOCUS);
      expect(screen.getAllByText(/Template no longer exists/)).toHaveLength(1);
      expect(screen.getByText(MISSING_COPY)).toBeTruthy();
      expect(screen.queryByText(/Set a Removal template/)).toBeNull();
      expect(landingLine()).toBeNull();
    });

    it("shows one neutral line when the pin is listed and a blocker still sent the operator here", () => {
      mount(true, false, FOCUS);
      expect(landingLine()?.textContent).toBe(REMOVAL_TEMPLATE_LANDING_LINE);
      expect(screen.queryByText(/Set a Removal template/)).toBeNull();
    });

    it("shows no landing line when the sheet was not opened by the link", () => {
      mount(true);
      expect(landingLine()).toBeNull();
    });
  });

  it("states the missing template as a fact alone on a read-only batch", () => {
    mocks.pin = null;
    mount(false, false, undefined, false, true);
    expect(screen.getByText("This credit batch has no Removal template.")).toBeTruthy();
    expect(screen.queryByText(/Ask an Admin|Set a Removal template/)).toBeNull();
    expect(screen.queryByRole("link", { name: "Change in Settings" })).toBeNull();
  });
});
