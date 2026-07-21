import { describe, expect, it } from "vitest";
import type { OnboardingStatus } from "@/data-access/onboarding";
import { buildStepHref } from "./onboarding-constants";
import { resolveMode } from "./use-onboarding-gate";
import { deriveSetupProgress } from "./use-setup-steps";

const FACILITY_ID = "3e0a4a86-1af9-4b39-a97e-08fbd8b0f1aa";

function makeStatus(overrides?: Partial<OnboardingStatus>): OnboardingStatus {
  return {
    isOwnerOrAdmin: true,
    isOrgOwnerOrAdmin: true,
    facilityCount: 1,
    supplierCount: 1,
    facility: {
      reactorCount: 1,
      registryConnected: true,
      feedstockCount: 1,
      completeProductionRunCount: 1,
      creditBatchCount: 1,
    },
    ...overrides,
  };
}

describe("deriveSetupProgress", () => {
  it("marks nothing done without a status", () => {
    const progress = deriveSetupProgress(undefined, null);
    expect(progress.doneCount).toBe(0);
    expect(progress.allComplete).toBe(false);
    expect(progress.activeIndex).toBe(0);
  });

  it("self-clears when every record exists", () => {
    const progress = deriveSetupProgress(makeStatus(), FACILITY_ID);
    expect(progress.doneCount).toBe(progress.total);
    expect(progress.allComplete).toBe(true);
    expect(progress.activeIndex).toBe(-1);
  });

  it("points activeIndex at the first missing record", () => {
    const status = makeStatus({
      facility: {
        reactorCount: 1,
        registryConnected: false,
        feedstockCount: 0,
        completeProductionRunCount: 0,
        creditBatchCount: 0,
      },
    });
    const progress = deriveSetupProgress(status, FACILITY_ID);
    // Chain order: facility, reactor done; registry (index 2) is first open.
    expect(progress.steps[2].id).toBe("registry");
    expect(progress.activeIndex).toBe(2);
    expect(progress.doneCount).toBe(3); // facility + reactor + supplier
  });

  it("treats an incomplete production run as not done", () => {
    const status = makeStatus({
      facility: {
        reactorCount: 1,
        registryConnected: true,
        feedstockCount: 1,
        completeProductionRunCount: 0,
        creditBatchCount: 1,
      },
    });
    const progress = deriveSetupProgress(status, FACILITY_ID);
    const production = progress.steps.find((s) => s.id === "production");
    expect(production?.done).toBe(false);
    expect(progress.allComplete).toBe(false);
  });
});

describe("buildStepHref", () => {
  it("opens each entity hub's create sheet scoped to the facility", () => {
    expect(buildStepHref("supplier", FACILITY_ID)).toBe(
      `/suppliers?create=true&facility=${FACILITY_ID}`,
    );
    expect(buildStepHref("credit", FACILITY_ID)).toBe(
      `/credit-batches?create=true&facility=${FACILITY_ID}`,
    );
  });

  it("routes registry to certification settings and facility to its hub", () => {
    expect(buildStepHref("registry", FACILITY_ID)).toBe(
      `/certification/settings?facility=${FACILITY_ID}`,
    );
    expect(buildStepHref("facility", null)).toBe("/facilities?create=true");
  });
});

describe("resolveMode", () => {
  function mode(
    status: OnboardingStatus | undefined,
    opts?: { isLoading?: boolean; facilityId?: string | null; collapsed?: boolean },
  ) {
    // `?? FACILITY_ID` would swallow an explicit `null` facilityId.
    const facilityId =
      opts && "facilityId" in opts ? (opts.facilityId ?? null) : FACILITY_ID;
    return resolveMode({
      isLoading: opts?.isLoading ?? false,
      status,
      facilityId,
      progress: deriveSetupProgress(status, facilityId),
      collapsed: opts?.collapsed ?? false,
    });
  }

  it("stays out of the way while loading and once setup is complete", () => {
    expect(mode(undefined, { isLoading: true })).toBe("none");
    expect(mode(makeStatus())).toBe("none");
  });

  it("takes over a zero-facility org by role", () => {
    const fresh = makeStatus({ facilityCount: 0, supplierCount: 0, facility: null });
    expect(mode(fresh, { facilityId: null })).toBe("takeover-guide");
    expect(mode({ ...fresh, isOwnerOrAdmin: false }, { facilityId: null })).toBe(
      "takeover-member",
    );
  });

  it("defers to the select-facility gate when facilities exist but none is active", () => {
    const status = makeStatus({ facility: null });
    expect(mode(status, { facilityId: null })).toBe("none");
  });

  it("collapses to a strip for an Owner/Admin who hid the guide", () => {
    // A REQUIRED step is still open (no feedstock intake) → the guide takes
    // over, or recedes to the strip when the Owner/Admin has hidden it.
    const status = makeStatus({
      facility: { ...makeStatus().facility!, feedstockCount: 0 },
    });
    expect(mode(status)).toBe("takeover-guide");
    expect(mode(status, { collapsed: true })).toBe("strip");
  });

  it("recedes to the real dashboard once every required step is done, even with the registry skipped", () => {
    // The registry link is legitimately optional: an Owner/Admin who completed
    // every required step but never connected Isometric must still get the full
    // dashboard, not a permanent 6/7 strip/takeover.
    const registrySkipped = makeStatus({
      facility: { ...makeStatus().facility!, registryConnected: false },
    });
    expect(deriveSetupProgress(registrySkipped, FACILITY_ID).allComplete).toBe(
      false,
    );
    expect(
      deriveSetupProgress(registrySkipped, FACILITY_ID).requiredComplete,
    ).toBe(true);
    expect(mode(registrySkipped)).toBe("none");
    expect(mode(registrySkipped, { collapsed: true })).toBe("none");
  });

  it("blocks a Member only while the facility is pre-operational", () => {
    const preOperational = makeStatus({
      isOwnerOrAdmin: false,
      facility: { ...makeStatus().facility!, reactorCount: 0 },
    });
    expect(mode(preOperational)).toBe("takeover-member");

    // Reactor exists → the Member gets the real dashboard even though later
    // steps (e.g. the platform-admin-gated registry link) are still open.
    const operational = makeStatus({
      isOwnerOrAdmin: false,
      facility: { ...makeStatus().facility!, registryConnected: false },
    });
    expect(mode(operational)).toBe("none");
  });
});
