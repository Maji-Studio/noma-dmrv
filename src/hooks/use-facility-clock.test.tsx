// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import type { Facility } from "@/db/schema";
import { FacilityContext, useFacilityClock, type FacilityContextValue } from "./use-facility-context";

const VALUE = {
  facilities: [{ id: "active", timezone: "Europe/Zurich" }] as Facility[],
} as FacilityContextValue;
const wrapper = ({ children }: { children: ReactNode }) => <FacilityContext.Provider value={VALUE}>{children}</FacilityContext.Provider>;

describe("useFacilityClock", () => {
  it("reads the zone of a facility in the list", () => {
    expect(renderHook(() => useFacilityClock("active"), { wrapper }).result.current.timeZone).toBe("Europe/Zurich");
  });

  it("uses the override for an archived facility outside the list, with a cue that names it", () => {
    const { timeZone, hint } = renderHook(() => useFacilityClock("archived", { timeZone: "Africa/Dar_es_Salaam" }), { wrapper }).result.current;
    expect(timeZone).toBe("Africa/Dar_es_Salaam");
    expect(hint).toContain("Dar es Salaam");
  });

  it("falls back to the list when the override is absent", () => {
    expect(renderHook(() => useFacilityClock("active", { timeZone: undefined }), { wrapper }).result.current.timeZone).toBe("Europe/Zurich");
  });
});
