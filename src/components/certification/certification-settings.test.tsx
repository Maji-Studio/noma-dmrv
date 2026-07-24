import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CertificationSettings } from "./certification-settings";

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
      durabilityOption: "200_year",
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

describe("CertificationSettings", () => {
  it("exposes a stable anchor for the emission-estimates section", () => {
    const html = renderToStaticMarkup(<CertificationSettings />);

    expect(html).toContain('<section id="emission-estimates"');
    expect(html).toContain("Emission estimates form");
  });

  it("makes the registry Source policy organization-wide on the facility settings surface", () => {
    const html = renderToStaticMarkup(<CertificationSettings />);

    expect(html).toContain(
      "Registry Source visibility — organization-wide",
    );
    expect(html).toContain("across all facilities");
    expect(html).toContain("Source visibility policy");
  });
});
