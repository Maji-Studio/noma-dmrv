// @vitest-environment jsdom
/**
 * Choosing the 1000-year tier unmounts the soil reference form, so its
 * unsaved draft blocks the tier save until it is saved or undone. Renders the
 * real tier control and the real soil form; only data hooks are stubbed.
 */
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingsViewer } from "@/lib/settings/panes";
import { FacilitySettingsPane, SOIL_DRAFT_BLOCKS_TIER_TEXT } from "./facility-settings-pane";

const FACILITY_ID = "11111111-1111-4111-8111-111111111111";
const saveSoil = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

vi.mock("@/components/ui/tooltip", () => ({
  InfoHint: () => null,
  Tooltip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn() }) }));
vi.mock("@/components/navigation", () => ({ SelectFacilityEmptyState: () => null }));
vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({
    facilityId: FACILITY_ID,
    selectedFacility: { id: FACILITY_ID, code: "FAC-1", name: "Facility One", durabilityOption: "200_year", version: 1 },
  }),
}));
vi.mock("@/hooks/use-certification", () => ({
  certificationKeys: { all: ["certification"] },
  useFacilityCertifierSummary: () => ({
    data: { isProduction: false, mapping: { externalProjectId: "prj_1", defaultSoilTemperatureC: null }, viewerCanManage: true },
    isLoading: false,
    error: null,
  }),
  useSaveFacilityEmissionConfig: () => ({ mutateAsync: saveSoil.mutateAsync, isPending: false }),
}));
vi.mock("@/hooks/use-facilities", () => ({
  useUpdateFacility: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/components/certification/facility-certifier-section", () => ({
  FacilityCertifierSection: () => <div>Project link</div>,
}));

const viewer = { canManage: true } as SettingsViewer;

beforeEach(() => {
  vi.clearAllMocks();
  saveSoil.mutateAsync.mockResolvedValue({});
});
afterEach(cleanup);

const temperature = () => document.querySelector<HTMLInputElement>("#defaultSoilTemperatureC")!;
const saveTier = () => screen.queryByRole("button", { name: "Save durability tier" });

describe("FacilitySettingsPane soil draft", () => {
  it("blocks the tier save while the soil reference holds a draft", async () => {
    render(<FacilitySettingsPane viewer={viewer} />);
    fireEvent.change(temperature(), { target: { value: "12.5" } });

    fireEvent.click(screen.getByRole("radio", { name: /1000-year/ }));

    expect(await screen.findByText(SOIL_DRAFT_BLOCKS_TIER_TEXT)).toBeTruthy();
    expect(saveTier()).toBeNull();
    // The draft is still there.
    expect(temperature().value).toBe("12.5");
  });

  it("offers the tier save once the draft is saved", async () => {
    render(<FacilitySettingsPane viewer={viewer} />);
    fireEvent.change(temperature(), { target: { value: "12.5" } });
    fireEvent.click(screen.getByRole("radio", { name: /1000-year/ }));
    await screen.findByText(SOIL_DRAFT_BLOCKS_TIER_TEXT);

    fireEvent.click(screen.getByRole("button", { name: "Save estimates" }));

    await waitFor(() => expect(screen.queryByText(SOIL_DRAFT_BLOCKS_TIER_TEXT)).toBeNull());
    expect(saveTier()).toBeTruthy();
  });

  it("offers the tier save straight away without a draft", () => {
    render(<FacilitySettingsPane viewer={viewer} />);
    fireEvent.click(screen.getByRole("radio", { name: /1000-year/ }));
    expect(saveTier()).toBeTruthy();
  });
});
