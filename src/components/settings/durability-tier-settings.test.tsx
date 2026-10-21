// @vitest-environment jsdom
/**
 * The durability tier moved from the facility form to Settings, Facilities
 * (Q9). It saves through the facility update action with only the tier and
 * the loaded version, without an optimistic write, so a refusal reaches a
 * form that still holds the operator's choice.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Facility } from "@/db/schema";
import { DurabilityTierSettings } from "./durability-tier-settings";

const update = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));
const hook = vi.hoisted(() => ({ useUpdateFacility: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn() }));

vi.mock("@/hooks/use-facilities", () => ({ useUpdateFacility: hook.useUpdateFacility }));
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

const thousand = () => screen.getByRole("radio", { name: /1000-year/ });
const save = () => screen.queryByRole("button", { name: "Save durability tier" });

beforeEach(() => {
  vi.clearAllMocks();
  hook.useUpdateFacility.mockReturnValue(update);
  update.mutateAsync.mockResolvedValue({});
});
afterEach(cleanup);

describe("DurabilityTierSettings", () => {
  it("offers Save only once the tier differs from the saved one", () => {
    render(<DurabilityTierSettings facility={facility} canManage />);
    expect(save()).toBeNull();

    fireEvent.click(thousand());

    expect(save()).toBeTruthy();
  });

  it("saves only the tier against the loaded version, without an optimistic write", async () => {
    render(<DurabilityTierSettings facility={facility} canManage />);
    fireEvent.click(thousand());
    fireEvent.click(save()!);

    await waitFor(() =>
      expect(update.mutateAsync).toHaveBeenCalledWith({
        facilityId: "fac-1",
        expectedVersion: 7,
        durabilityOption: "1000_year",
      }),
    );
    expect(hook.useUpdateFacility).toHaveBeenCalledWith(undefined, { optimistic: false });
    expect(toast.success).toHaveBeenCalledWith("Durability tier saved for FAC-1.");
  });

  it("shows a refusal and keeps the operator's choice", async () => {
    update.mutateAsync.mockRejectedValue(
      new Error("The durability tier is locked because this facility has a registry submission."),
    );
    render(<DurabilityTierSettings facility={facility} canManage />);
    fireEvent.click(thousand());
    fireEvent.click(save()!);

    expect(
      await screen.findByText("The durability tier is locked because this facility has a registry submission."),
    ).toBeTruthy();
    expect(thousand().getAttribute("aria-checked")).toBe("true");
    expect(save()).toBeTruthy();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("keeps the choice when the facility refetches with the same tier", () => {
    const view = render(<DurabilityTierSettings facility={facility} canManage />);
    fireEvent.click(thousand());

    view.rerender(<DurabilityTierSettings facility={{ ...facility, version: 8 } as Facility} canManage />);

    expect(thousand().getAttribute("aria-checked")).toBe("true");
    expect(save()).toBeTruthy();
  });

  it("replaces Save with the reason while a change cannot be saved", () => {
    render(<DurabilityTierSettings facility={facility} canManage blockedReason="Save the soil value first." />);
    fireEvent.click(thousand());

    expect(screen.getByText("Save the soil value first.")).toBeTruthy();
    expect(save()).toBeNull();
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
