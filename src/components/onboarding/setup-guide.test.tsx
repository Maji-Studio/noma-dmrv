import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui";
import { SetupGuide } from "./setup-guide";
import { SetupStrip } from "./setup-strip";
import { deriveSetupProgress } from "./use-setup-steps";
import type { OnboardingStatus } from "@/data-access/onboarding";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const actions = {
  facilityId: null as string | null,
  onOpenFacility: vi.fn(),
  onOpenReactor: vi.fn(),
  onOpenRegistry: vi.fn(),
};
const empty: OnboardingStatus = {
  isOwnerOrAdmin: true, isOrgOwnerOrAdmin: true,
  facilityCount: 0, supplierCount: 0, facility: null,
};
let renderer: ReactTestRenderer;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  actions.facilityId = null;
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
});

describe("dashboard setup actions", () => {
  it.each([
    [0, "Add facility", "onOpenFacility"],
    [1, "Register reactor", "onOpenReactor"],
    [2, "Connect registry", "onOpenRegistry"],
  ] as const)("makes step %s the only primary action and opens its shared surface", async (activeIndex, label, handler) => {
    actions.facilityId = activeIndex === 0 ? null : "facility-1";
    const status = activeIndex === 0 ? empty : {
      ...empty, facilityCount: 1,
      facility: {
        reactorCount: activeIndex === 2 ? 1 : 0,
        registryConnected: false, feedstockCount: 0,
        completeProductionRunCount: 0, creditBatchCount: 0,
      },
    };
    const progress = deriveSetupProgress(status, actions.facilityId);
    await act(async () => {
      renderer = create(<SetupGuide progress={progress} actions={actions} onCollapse={vi.fn()} />);
    });
    expect(progress.activeIndex).toBe(activeIndex);
    const primary = renderer.root.findAllByType(Button).filter((node) => node.props.variant === "primary");
    expect(primary).toHaveLength(1);
    expect(primary[0].props.children).toBe(label);
    await act(async () => primary[0].props.onClick());
    expect(actions[handler]).toHaveBeenCalledOnce();
    expect(push).not.toHaveBeenCalled();
    expect(renderer.root.findAllByType("li").filter((node) => node.props["aria-current"] === "step")).toHaveLength(1);
  });

  it("keeps later steps secondary and requires a facility before reactor or registry setup", async () => {
    await act(async () => {
      renderer = create(<SetupGuide progress={deriveSetupProgress(empty, null)} actions={actions} onCollapse={vi.fn()} />);
    });
    const buttons = renderer.root.findAllByType(Button);
    for (const label of ["Register reactor", "Connect registry"]) {
      const button = buttons.find((node) => node.props.children === label)!;
      expect(button.props.variant).toBe("default");
      expect(button.props.disabled).toBe(true);
    }
    const supplier = buttons.find((node) => node.props.children === "Add supplier")!;
    expect(supplier.props.variant).toBe("default");
    await act(async () => supplier.props.onClick());
    expect(push).toHaveBeenCalledWith("/suppliers?create=true");
  });

  it("opens the active surface directly from the collapsed strip", async () => {
    await act(async () => {
      renderer = create(<SetupStrip progress={deriveSetupProgress(empty, null)} actions={actions} onExpand={vi.fn()} />);
    });
    const button = renderer.root.findAllByType(Button).find((node) => node.props.children === "Add facility")!;
    await act(async () => button.props.onClick());
    expect(actions.onOpenFacility).toHaveBeenCalledOnce();
  });
});
