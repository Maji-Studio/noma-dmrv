// @vitest-environment jsdom
/**
 * The durability tier moved from the facility form to Settings, Facilities
 * (Q9). It saves through the facility update action with only the tier and
 * the loaded version, so nothing else on the facility can be overwritten.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Facility } from "@/db/schema";
import { DurabilityTierSettings } from "./durability-tier-settings";

const update = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));
const toast = vi.hoisted(() => ({ success: vi.fn() }));

vi.mock("@/hooks/use-facilities", () => ({ useUpdateFacility: () => update }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => toast }));
vi.mock("@/components/ui/tooltip", () => ({
  InfoHint: () => null,
  Tooltip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

const facility = {
  id: "fac-1",
  code: "FAC-1",
  version: 7,
  durabilityOption: "200_year",
} as Facility;

beforeEach(() => {
  vi.clearAllMocks();
  update.mutateAsync.mockResolvedValue({});
});
afterEach(cleanup);

describe("DurabilityTierSettings", () => {
  it("offers Save only once the tier differs from the saved one", () => {
    render(<DurabilityTierSettings facility={facility} canManage />);
    expect(screen.queryByRole("button", { name: "Save durability tier" })).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: /1000-year/ }));

    expect(screen.getByRole("button", { name: "Save durability tier" })).toBeTruthy();
  });

  it("saves only the tier against the loaded version", async () => {
    render(<DurabilityTierSettings facility={facility} canManage />);
    fireEvent.click(screen.getByRole("radio", { name: /1000-year/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save durability tier" }));

    await waitFor(() =>
      expect(update.mutateAsync).toHaveBeenCalledWith({
        facilityId: "fac-1",
        expectedVersion: 7,
        durabilityOption: "1000_year",
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Durability tier saved for FAC-1.");
  });

  it("keeps the 200-year tier locked as before", () => {
    render(<DurabilityTierSettings facility={{ ...facility, durabilityOption: "1000_year" } as Facility} canManage />);
    expect(screen.getByRole("radio", { name: /200-year/ }).getAttribute("aria-disabled")).toBe("true");
  });

  it("shows a member the tier without a control", () => {
    render(<DurabilityTierSettings facility={facility} canManage={false} />);
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByTestId("durability-tier-info").textContent).toContain("200-year durability");
  });
});
