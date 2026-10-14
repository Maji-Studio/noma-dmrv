import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveSetupProgress } from "@/components/onboarding/use-setup-steps";
import { DashboardView } from "./dashboard-view";
import { RegistryConnectionDialog } from "@/components/certification/registry-connection-dialog";
import type { OnboardingStatus } from "@/data-access/onboarding";

const mocks = vi.hoisted(() => ({
  facilityId: null as string | null,
  mode: "takeover-guide",
  reactors: 0,
  setFacilityId: vi.fn(),
  createFacility: vi.fn(),
  createReactor: vi.fn(),
}));
vi.mock("@/components/onboarding", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/onboarding")>(),
  useSetupGuide: () => {
    const status: OnboardingStatus = {
      isOwnerOrAdmin: true, isOrgOwnerOrAdmin: true,
      facilityCount: mocks.facilityId ? 1 : 0, supplierCount: 0,
      facility: mocks.facilityId ? {
        reactorCount: mocks.reactors, registryConnected: false, feedstockCount: 0,
        completeProductionRunCount: 0, creditBatchCount: 0,
      } : null,
    };
    return { mode: mocks.mode, status, progress: deriveSetupProgress(status, mocks.facilityId), setCollapsed: vi.fn() };
  },
}));
vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({ facilityId: mocks.facilityId, activeOrganizationId: "org-1", setFacilityId: mocks.setFacilityId }),
}));
vi.mock("@/hooks/use-dashboard-overview", () => ({ useDashboardOverview: () => ({ data: undefined, isLoading: false }) }));
vi.mock("@/hooks/use-facilities", () => ({ useCreateFacility: () => ({ mutateAsync: mocks.createFacility, isPending: false }) }));
vi.mock("@/hooks/use-reactors", () => ({ useCreateReactor: () => ({ mutateAsync: mocks.createReactor, isPending: false }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn() }) }));
vi.mock("@/components/ui/entity-side-sheet", () => ({
  EntitySideSheet: ({ title, children }: { title: string; children: ReactNode }) => <section aria-label={title}>{children}</section>,
}));
vi.mock("@/components/facilities/facility-form", () => ({
  FacilityForm: ({ onSubmit, errorMessage }: { onSubmit: (data: object) => void; errorMessage?: string }) => <><button onClick={() => onSubmit({ name: "Facility", timezone: "UTC" })}>Create facility</button><p role="alert">{errorMessage}</p></>,
}));
vi.mock("@/components/reactors/reactor-form", () => ({
  ReactorForm: ({ onSubmit }: { onSubmit: (data: object) => void }) => <button onClick={() => onSubmit({ identifier: "Reactor", facilityId: mocks.facilityId })}>Create reactor</button>,
}));
vi.mock("@/components/certification/registry-connection-dialog", () => ({ RegistryConnectionDialog: () => <section aria-label="Registry connection" /> }));
let renderer: ReactTestRenderer;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  mocks.facilityId = null;
  mocks.mode = "takeover-guide";
  mocks.reactors = 0;
  mocks.setFacilityId.mockImplementation((id: string) => { mocks.facilityId = id; });
  mocks.createFacility.mockResolvedValue({ id: "facility-1" });
  mocks.createReactor.mockImplementation(async () => { mocks.reactors = 1; });
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
});
async function mount() { await act(async () => { renderer = create(<DashboardView />); }); }
async function click(label: string) {
  const button = renderer.root.findAllByType("button").find((node) => node.children.includes(label))!;
  await act(async () => { await button.props.onClick(); });
}
function sheets() { return renderer.root.findAllByType("section").filter((node) => node.props["aria-label"]?.startsWith("Create")); }

describe("DashboardView setup surfaces", () => {
  it("opens one shared create surface at a time and returns to the next dashboard step after saving", async () => {
    await mount();
    expect(sheets()).toHaveLength(0);
    await click("Add facility");
    expect(sheets()[0].props["aria-label"]).toBe("Create facility");
    await click("Create facility");
    expect(mocks.createFacility).toHaveBeenCalledWith({ name: "Facility", timezone: "UTC" });
    expect(mocks.setFacilityId).toHaveBeenCalledWith("facility-1");
    expect(sheets()).toHaveLength(0);
    expect(renderer.root.findByProps({ "aria-current": "step" }).findAllByType("button")[0].children).toContain("Register reactor");
    await click("Register reactor");
    expect(sheets()[0].props["aria-label"]).toBe("Create reactor");
    await click("Create reactor");
    expect(mocks.createReactor).toHaveBeenCalledWith({ identifier: "Reactor", facilityId: "facility-1" });
    expect(sheets()).toHaveLength(0);
    await click("Connect registry");
    const registry = renderer.root.findByType(RegistryConnectionDialog);
    expect(registry.props.facilityId).toBe("facility-1");
    expect(registry.props.canManage).toBe(true);
  });

  it("preserves the create sheet after a failed save", async () => {
    mocks.createFacility.mockRejectedValue(new Error("Facility was not created."));
    await mount();
    await click("Add facility");
    await click("Create facility");
    expect(sheets()).toHaveLength(1);
    expect(renderer.root.findByProps({ role: "alert" }).children).toContain("Facility was not created.");
    expect(mocks.setFacilityId).not.toHaveBeenCalled();
  });

  it("keeps members on Setup in progress with no setup surfaces", async () => {
    mocks.mode = "takeover-member";
    await mount();
    expect(JSON.stringify(renderer.toJSON())).toContain("Setup in progress");
    expect(sheets()).toHaveLength(0);
    expect(renderer.root.findAllByType("button").some((node) => node.children.includes("Add facility"))).toBe(false);
  });
});
