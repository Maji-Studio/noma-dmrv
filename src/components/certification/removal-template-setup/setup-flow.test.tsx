// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StaleVersionError } from "@/lib/stale-version";
import { RemovalTemplateSetupFlow } from "./setup-flow";
import { dieselSource, electricityClash, setupData, startupDefault, template } from "./test-support";

const push = vi.fn();
const mutateAsync = vi.fn();
const success = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success }) }));
vi.mock("@/hooks/use-removal-template-setup", () => ({
  useApplyRemovalTemplateSetup: () => ({ mutateAsync, isPending: false }),
}));

const FACILITY = "11111111-1111-4111-8111-111111111111";
const withDecisions = template("tpl-protocol", "Protocol default", { decisions: [electricityClash, dieselSource], defaults: [startupDefault] });
const nothingToDecide = template("tpl-ready", "Sandbox template", { defaults: [startupDefault] });

function renderFlow(data = setupData({ fitting: [withDecisions, nothingToDecide] }), props: Partial<React.ComponentProps<typeof RemovalTemplateSetupFlow>> = {}) {
  return render(
    <RemovalTemplateSetupFlow data={data} facilityId={FACILITY} templateId={null} step={null} makeDefault onReload={vi.fn()} {...props} />,
  );
}

beforeEach(() => { vi.clearAllMocks(); mutateAsync.mockResolvedValue({}); });
afterEach(cleanup);

describe("RemovalTemplateSetupFlow", () => {
  it("preselects nothing when several templates fit and Continue waits for a pick", () => {
    renderFlow();
    expect((screen.getByRole("radio", { name: /Protocol default/ }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Pick a template to continue.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Pick the template" })).toBeTruthy();
    // Decisions and Apply are not reachable from the rail before the pick.
    expect(screen.queryByRole("button", { name: /^Decisions/ })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /Protocol default/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: "Decide what noma cannot" })).toBeTruthy();
  });

  it("opens on Apply for the one template that fits with nothing to decide", () => {
    renderFlow(setupData({ fitting: [nothingToDecide] }));
    expect(screen.getByRole("heading", { name: "Apply the setup" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Make default and set on 2 batches" })).toBeTruthy();
    expect(screen.getByText(/is the only template that fits/)).toBeTruthy();
  });

  it("holds Continue on Decisions until every decision is answered, naming what is open", () => {
    renderFlow(setupData({ fitting: [withDecisions] }), { step: "decisions" });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: "Decide what noma cannot" })).toBeTruthy();
    expect(screen.getByText(/2 to decide: Pyrolyzer electricity usage, Biomass processing fuel usage\./)).toBeTruthy();
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

  it("sends fingerprints, answers and batches with versions, then returns to Settings", async () => {
    renderFlow(setupData({ fitting: [withDecisions] }), { step: "decisions" });
    fireEvent.click(screen.getByRole("radio", { name: /^Pyrolyzer electricity usage/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Generator diesel from production runs/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Make default and set on 2 batches" }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(mutateAsync).toHaveBeenCalledWith({
      facilityId: FACILITY,
      removalTemplateId: "tpl-protocol",
      fingerprints: { semanticFingerprint: "tpl-protocol-semantic", fullFingerprint: "tpl-protocol-full" },
      answers: { "clash:run-electricity": "pyrolyzer", fuel: "run-genset-diesel" },
      overrides: {},
      makeDefault: true,
      batches: [
        { id: "22222222-2222-4222-8222-222222222222", expectedVersion: 3 },
        { id: "33333333-3333-4333-8333-333333333333", expectedVersion: 1 },
      ],
    });
    expect(success).toHaveBeenCalled();
    expect(push.mock.calls[0][0]).toContain("section=removal-templates");
  });

  it("leaves Make default off when the batch dialog sent the operator here", () => {
    renderFlow(setupData({ fitting: [nothingToDecide] }), { makeDefault: false });
    expect((screen.getByRole("checkbox", { name: /Make it the default/ }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole("button", { name: "Save decisions" })).toBeTruthy();
  });

  it("shows the server's stale message and offers a reload", async () => {
    const onReload = vi.fn();
    mutateAsync.mockRejectedValue(new StaleVersionError("The template changed in Isometric. Review it again.", { entity: "removal_template_observation", id: "tpl-ready", code: "stale_version" } as never));
    renderFlow(setupData({ fitting: [nothingToDecide] }), { onReload });
    fireEvent.click(screen.getByRole("button", { name: /Make default/ }));
    expect(await screen.findByText("The template changed in Isometric. Review it again.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reload template" }));
    expect(onReload).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});
