import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { CertifierProjectRow } from "@/data-access/certification";
import { EmissionEstimatesForm } from "./emission-estimates-form";

vi.mock("@/hooks/use-certification", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/hooks/use-certification")>(),
  useSaveFacilityEmissionConfig: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn() }) }));
vi.mock("@/components/ui/tooltip", () => ({
  InfoHint: () => null,
  Tooltip: ({ children }: { children: ReactNode }) => children,
}));

const mapping = { id: "mapping-1", externalFacilityId: "fcl_1", defaultSoilTemperatureC: null } as CertifierProjectRow;

describe("EmissionEstimatesForm certification marker", () => {
  it.each([
    { temperature: null, description: "Required for certification. Not provided." },
    { temperature: 20, description: "Required for certification. Provided." },
  ])("reports the saved 200-year soil reference ($temperature)", ({ temperature, description }) => {
    const html = renderToStaticMarkup(<EmissionEstimatesForm
      facilityId="facility-1" mapping={{ ...mapping, defaultSoilTemperatureC: temperature }} durabilityOption="200_year"
    />);
    expect(html).toContain(description);
    expect(html).toContain('name="defaultSoilTemperatureC"');
    expect(html).not.toContain('name="gensetEnergyYieldKwhPerLitre"');
  });

  it("has no emission inputs or marker for a 1000-year facility", () => {
    const html = renderToStaticMarkup(<EmissionEstimatesForm facilityId="facility-1" mapping={mapping} durabilityOption="1000_year" />);
    expect(html).not.toContain("Required for certification");
    expect(html).not.toContain("<input");
  });
});
