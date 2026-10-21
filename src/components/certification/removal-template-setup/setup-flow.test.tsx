// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StaleVersionError } from "@/lib/stale-version";
import { RemovalTemplateSetupFlow } from "./setup-flow";
import { REMOVAL_TEMPLATE_BLOCKERS } from "@/lib/certification/removal-template-blockers";
import { addedComponent, dieselSource, electricityClash, setupData, startupDefault, template } from "./test-support";

const onClose = vi.fn();
const mutateAsync = vi.fn();
const never = () => new Promise(() => undefined);
const success = vi.fn();
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success }) }));
const applyMutation = { mutateAsync, isPending: false } as unknown as React.ComponentProps<typeof RemovalTemplateSetupFlow>["apply"];

const FACILITY = "11111111-1111-4111-8111-111111111111";
const withDecisions = template("tpl-protocol", "Protocol default", { decisions: [electricityClash, dieselSource], defaults: [startupDefault] });
const nothingToDecide = template("tpl-ready", "Sandbox template", { defaults: [startupDefault] });

function renderFlow(data = setupData({ fitting: [withDecisions, nothingToDecide] }), props: Partial<React.ComponentProps<typeof RemovalTemplateSetupFlow>> = {}) {
  return render(
    <RemovalTemplateSetupFlow data={data} facilityId={FACILITY} templateId={null} step={null} makeDefault onReload={vi.fn()} onClose={onClose} apply={applyMutation} {...props} />,
  );
}

beforeEach(() => { vi.clearAllMocks(); mutateAsync.mockResolvedValue({}); });
afterEach(cleanup);

describe("RemovalTemplateSetupFlow", () => {
  it("preselects nothing when several templates fit and Continue waits for a pick", () => {
    renderFlow();
    expect((screen.getByRole("radio", { name: /Protocol default/ }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Pick a template to continue.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Pick the template" })).toBeTruthy();
    // Decisions and Apply are not reachable from the rail before the pick.
    expect(screen.queryByRole("button", { name: /^Decisions/ })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /Protocol default/ }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Decide what noma cannot" })).toBeTruthy();
  });

  it("lists the one template that fits, preselected, and goes straight to Apply when nothing is left to decide", () => {
    renderFlow(setupData({ fitting: [nothingToDecide] }));
    expect(screen.getByRole("heading", { name: "Pick the template" })).toBeTruthy();
    expect((screen.getByRole("radio", { name: /Sandbox template/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Apply the setup" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Make default and set on 2 credit batches" })).toBeTruthy();
    // Back skips the Decisions step that had nothing to decide.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Pick the template" })).toBeTruthy();
  });

  it("lists templates that do not fit as disabled rows marked Does not fit, with their reason", () => {
    const unfit = { id: "tpl-unfit", name: "Wrong tier", reason: "The storage component does not match this facility's durability tier." };
    renderFlow(setupData({ fitting: [nothingToDecide], notFitting: [unfit] }));
    const radio = screen.getByRole("radio", { name: /Wrong tier/ }) as HTMLInputElement;
    expect(radio.disabled).toBe(true);
    expect(screen.getByText("Does not fit")).toBeTruthy();
    expect(screen.getByText(unfit.reason)).toBeTruthy();
    expect(screen.queryByText(/Not offered/)).toBeNull();
    // The one that fits stays selected, so the operator is never stuck.
    expect((screen.getByRole("radio", { name: /Sandbox template/ }) as HTMLInputElement).checked).toBe(true);
  });

  it("holds Continue on Decisions until every decision is answered, naming what is open", () => {
    renderFlow(setupData({ fitting: [withDecisions] }), { step: "decisions" });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Decide what noma cannot" })).toBeTruthy();
    expect(screen.getByText(/2 to decide: Which component gets electricity from production runs\? Which source fills Biomass processing fuel usage\?/)).toBeTruthy();
  });

  it("disables an option another component already holds and says why", () => {
    renderFlow(setupData({ fitting: [withDecisions] }), { step: "decisions" });
    const startup = screen.getByRole("radio", { name: /Startup diesel from production runs/ }) as HTMLInputElement;
    expect(startup.disabled).toBe(true);
    expect(screen.getByText(/Already used by another component\./)).toBeTruthy();
    expect((screen.getByRole("radio", { name: /Generator diesel from production runs/ }) as HTMLInputElement).disabled).toBe(false);
    // The server may send a raw source id; the page shows the human label.
    expect(screen.queryByText("run-genset-diesel")).toBeNull();
  });

  it("sends fingerprints, answers and batches with versions, then closes the dialog", async () => {
    renderFlow(setupData({ fitting: [withDecisions] }), { step: "decisions" });
    fireEvent.click(screen.getByRole("radio", { name: /^Pyrolyzer electricity usage/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Generator diesel from production runs/ }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Make default and set on 2 credit batches" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mutateAsync).toHaveBeenCalledWith({
      facilityId: FACILITY,
      removalTemplateId: "tpl-protocol",
      fingerprints: { semanticFingerprint: "tpl-protocol-semantic", fullFingerprint: "tpl-protocol-full" },
      planFingerprint: "tpl-protocol-plan",
      answers: { "clash:run-electricity": "pyrolyzer", fuel: "run-genset-diesel" },
      overrides: {},
      makeDefault: true,
      batches: [
        { id: "22222222-2222-4222-8222-222222222222", expectedVersion: 3 },
        { id: "33333333-3333-4333-8333-333333333333", expectedVersion: 1 },
      ],
    });
    expect(success).toHaveBeenCalled();
  });

  it("leaves Make default off when the batch dialog sent the operator here", () => {
    renderFlow(setupData({ fitting: [nothingToDecide] }), { makeDefault: false, step: "apply" });
    expect((screen.getByRole("checkbox", { name: /Make it the default/ }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole("button", { name: "Save decisions" })).toBeTruthy();
  });

  it("shows the server's stale message and offers a reload", async () => {
    const onReload = vi.fn();
    mutateAsync.mockRejectedValue(new StaleVersionError("The template changed in Isometric. Review it again.", { entity: "removal_template_observation", id: "tpl-ready", code: "stale_version" } as never));
    renderFlow(setupData({ fitting: [nothingToDecide] }), { onReload, step: "apply" });
    fireEvent.click(screen.getByRole("button", { name: /Make default/ }));
    expect(await screen.findByText("The template changed in Isometric. Review it again.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reload template" }));
    expect(onReload).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows why a blocked template cannot be picked and never offers it", () => {
    const blocked = template("tpl-blocked", "Fixed values missing", { defaults: [startupDefault] }, REMOVAL_TEMPLATE_BLOCKERS.missingFixedDatapoint);
    renderFlow(setupData({ fitting: [withDecisions, blocked] }));
    const radio = screen.getByRole("radio", { name: /Fixed values missing/ }) as HTMLInputElement;
    expect(radio.disabled).toBe(true);
    expect(screen.getByText(/Isometric has fixed values without a datapoint in this template/)).toBeTruthy();
    expect(screen.queryByText(/before submitting/)).toBeNull();
  });

  it("keeps Continue disabled and says so when every template is blocked", () => {
    const blocked = template("tpl-blocked", "Fixed values missing", { defaults: [startupDefault] }, REMOVAL_TEMPLATE_BLOCKERS.missingFixedDatapoint);
    renderFlow(setupData({ fitting: [blocked] }));
    expect(screen.getByRole("heading", { name: "Pick the template" })).toBeTruthy();
    expect(screen.getByText(/This template cannot be set up yet\./)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("opens the noma decided list through a disclosure button", () => {
    renderFlow(setupData({ fitting: [withDecisions] }), { step: "decisions" });
    const toggle = screen.getByRole("button", { name: /noma decided 1 component/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByLabelText("What fills Startup fuel usage")).toBeTruthy();
  });

  it("explains a clash in plain words", () => {
    renderFlow(setupData({ fitting: [withDecisions] }), { step: "decisions" });
    expect(screen.getByText("noma keeps one electricity figure per production run. Two components in this template ask for it, and one figure cannot fill both.")).toBeTruthy();
  });

  it("Cancel closes the dialog without applying", () => {
    renderFlow();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("sends one apply for a double click", async () => {
    mutateAsync.mockImplementation(never);
    renderFlow(setupData({ fitting: [nothingToDecide] }), { step: "apply" });
    const apply = screen.getByRole("button", { name: /Make default/ });
    fireEvent.click(apply);
    fireEvent.click(apply);
    expect(mutateAsync).toHaveBeenCalledTimes(1);
  });

  it("keeps the batch versions and fingerprints the draft started with when the data refreshes", async () => {
    const view = renderFlow(setupData({ fitting: [nothingToDecide] }), { step: "apply" });
    const refreshed = setupData({
      fitting: [{ ...nothingToDecide, planFingerprint: "newer-plan" }],
      batchesWithoutTemplate: [{ id: "22222222-2222-4222-8222-222222222222", code: "CB-26-001", version: 9 }],
    });
    view.rerender(<RemovalTemplateSetupFlow data={refreshed} facilityId={FACILITY} templateId={null} step={null} makeDefault onReload={vi.fn()} onClose={onClose} apply={applyMutation} />);
    fireEvent.click(screen.getByRole("button", { name: /Make default/ }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    const sent = mutateAsync.mock.calls[0][0];
    expect(sent.planFingerprint).toBe("tpl-ready-plan");
    expect(sent.batches).toEqual([
      { id: "22222222-2222-4222-8222-222222222222", expectedVersion: 3 },
      { id: "33333333-3333-4333-8333-333333333333", expectedVersion: 1 },
    ]);
  });

  it("never opens another template when the requested one is not offered, and says why", () => {
    const unfit = { id: "tpl-unfit", name: "Wrong tier", reason: "The storage component does not match this facility's durability tier." };
    renderFlow(setupData({ fitting: [nothingToDecide, withDecisions], notFitting: [unfit] }), { templateId: "tpl-unfit", step: "decisions" });
    expect(screen.getByRole("heading", { name: "Pick the template" })).toBeTruthy();
    expect((screen.getByRole("radio", { name: /Wrong tier/ }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getAllByRole("radio").every((radio) => !(radio as HTMLInputElement).checked)).toBe(true);
    cleanup();
    renderFlow(setupData({ fitting: [nothingToDecide] }), { templateId: "tpl-gone", step: "decisions" });
    expect(screen.getByText(/not in this Isometric project/)).toBeTruthy();
    // The one template that fits stays selectable, so the operator is never stuck.
    fireEvent.click(screen.getByRole("radio", { name: /Sandbox template/ }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Apply the setup" })).toBeTruthy();
  });

  it("hides Now to After and Make default for the template that is already the default", () => {
    renderFlow(setupData({ fitting: [nothingToDecide], defaultRemovalTemplateId: "tpl-ready" }), { step: "apply" });
    expect(screen.queryByText("Now")).toBeNull();
    expect(screen.queryByRole("checkbox", { name: /Make it the default/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Set on 2 credit batches" })).toBeTruthy();
  });

  it("offers a way out when no template fits", () => {
    renderFlow(setupData({ fitting: [] }));
    expect(screen.getByText(/No Removal template in Tanzania biochar fits this facility/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Certifier" }).getAttribute("href")).toContain("section=certifier");
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("asks an added component explicitly, with nothing preselected", () => {
    const added = template("tpl-added", "Changed template", { decisions: [addedComponent] });
    renderFlow(setupData({ fitting: [added] }), { step: "decisions" });
    expect(screen.getByRole("heading", { name: /How should noma fill Staff transport\?/ })).toBeTruthy();
    expect(screen.getAllByRole("radio").every((radio) => !(radio as HTMLInputElement).checked)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText(/1 to decide/)).toBeTruthy();
  });
});
