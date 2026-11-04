// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Facility } from "@/db/schema";
import { LOCKED_FIELD_MESSAGE } from "@/lib/save-refusal";
import { fieldRefusal } from "../../../tests/helpers/refusal-form-parent";
import { DurabilityTierSettings } from "./durability-tier-settings";

const update = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));
vi.mock("@/hooks/use-facilities", () => ({ useUpdateFacility: () => update }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn() }) }));
vi.mock("@/components/ui/tooltip", () => ({
  InfoHint: () => null,
  Tooltip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

const facility = { id: "fac-1", code: "FAC-1", version: 7, durabilityOption: "200_year" } as Facility;
const LOCK_REASON = "The durability tier is locked because this facility has a registry submission.";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DurabilityTierSettings lock refusal", () => {
  it("puts the tier back, says Locked at the field and gives the reason once", async () => {
    update.mutateAsync.mockRejectedValue(fieldRefusal(["durabilityOption"], LOCK_REASON, "certification_locked"));
    render(<DurabilityTierSettings facility={facility} canManage />);
    fireEvent.click(screen.getByRole("radio", { name: /1000-year/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save durability tier" }));

    await waitFor(() => expect(document.getElementById("facility-durability-tier-error")?.textContent).toContain(LOCKED_FIELD_MESSAGE));
    expect(screen.getAllByText(LOCK_REASON)).toHaveLength(1);
    expect(screen.getByRole("radio", { name: /200-year/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: /1000-year/ }).getAttribute("aria-checked")).toBe("false");
  });
});
