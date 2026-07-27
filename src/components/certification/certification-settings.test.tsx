import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CertificationSettings } from "./certification-settings";

const facilityState = vi.hoisted(() => ({
  durabilityOption: "200_year" as "200_year" | "1000_year",
}));

vi.mock("@/components/admin/emission-estimates-form", () => ({
  EmissionEstimatesForm: () => <div>Emission estimates form</div>,
}));

vi.mock("@/components/organizations/organization-certifier-credentials", () => ({
  OrganizationCertifierCredentials: () => <div>Credentials</div>,
}));

vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({
    facilityId: "facility-1",
    selectedFacility: {
      code: "FAC-1",
      name: "Facility One",
      durabilityOption: facilityState.durabilityOption,
    },
  }),
}));

vi.mock("@/hooks/use-is-admin", () => ({
  useIsAdmin: () => false,
}));

vi.mock("@/hooks/use-organizations", () => ({
  useActiveOrganizationProfile: () => ({
    data: { id: "organization-1", name: "Organization One" },
  }),
}));

vi.mock("@/hooks/use-certification", () => ({
  useFacilityCertifierSummary: () => ({
    data: {
      isProduction: false,
      mapping: null,
      viewerCanManage: true,
    },
    isLoading: false,
  }),
}));

vi.mock("./certification-health-panel", () => ({
  CertificationHealthPanel: () => <div>Health</div>,
}));

vi.mock("./env-banner", () => ({
  EnvBanner: () => <div>Environment</div>,
}));

vi.mock("./facility-certifier-section", () => ({
  FacilityCertifierSection: () => <div>Connection</div>,
}));

vi.mock("./registry-source-visibility-settings", () => ({
  RegistrySourceVisibilitySettings: () => <div>Source visibility policy</div>,
}));

beforeEach(() => {
  facilityState.durabilityOption = "200_year";
});

describe("CertificationSettings", () => {
  it("keeps the stable emission-estimates section for 200-year facilities", () => {
    const html = renderToStaticMarkup(<CertificationSettings />);

    expect(html).toContain('<section id="emission-estimates"');
    expect(html).toContain("Emission estimates form");
  });

  it("omits the entire emission-estimates section for 1000-year facilities", () => {
    facilityState.durabilityOption = "1000_year";

    const html = renderToStaticMarkup(<CertificationSettings />);

    expect(html).not.toContain('<section id="emission-estimates"');
    expect(html).not.toContain(
      "Reference soil temperature for 200-year durability removals.",
    );
    expect(html).not.toContain("Emission estimates form");
  });

  it("makes the registry Source policy organization-wide on the facility settings surface", () => {
    const html = renderToStaticMarkup(<CertificationSettings />);

    expect(html).toContain("Registry Source visibility");
    expect(html).toContain(
      "Default visibility for new Isometric Sources across all facilities.",
    );
    expect(html).toContain("Source visibility policy");
  });
});
