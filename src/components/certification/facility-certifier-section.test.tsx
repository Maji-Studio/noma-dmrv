import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FacilityCertifierMapping } from "@/fn/certification/facility-mapping";
import { FacilityCertifierForm } from "./facility-certifier-dialog";
import { FacilityCertifierSection } from "./facility-certifier-section";

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: vi.fn() }),
}));

vi.mock("@/hooks/use-certification", () => ({
  useFacilityCertifierMapping: () => ({
    data: {
      mapping: null,
      availableProjects: [
        {
          id: "prj_test",
          name: "Test project",
        },
      ],
      availableTemplates: [],
      linkHints: [],
      isProduction: false,
      isConfigured: true,
    },
    isLoading: false,
    error: null,
  }),
  useFacilityCertifierSummary: vi.fn(),
  useDeleteFacilityCertifierMapping: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useIsometricProjectTemplates: () => ({
    data: [],
    isLoading: false,
  }),
  useSaveFacilityCertifierMapping: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

describe("FacilityCertifierSection", () => {
  it("starts an inline link flow with only the project selector", () => {
    const markup = renderToStaticMarkup(
      <FacilityCertifierSection
        facilityId="facility-1"
        canManage
        embedded
        linkPresentation="inline"
      />,
    );

    expect(markup).toContain("Select a project");
    expect(markup).not.toContain(">Link Isometric project<");
    expect(markup).not.toContain("Default Removal template");
    expect(markup).not.toContain("Isometric facility ID");
  });

  it("reveals project-dependent fields once a project is selected", () => {
    const loaderData = {
      mapping: {
        externalProjectId: "prj_test",
        protocolSlug: "biochar",
        defaultRemovalTemplateId: null,
        externalFacilityId: null,
      } as NonNullable<FacilityCertifierMapping["mapping"]>,
      availableProjects: [
        {
          id: "prj_test",
          name: "Test project",
          country_code: "TZ",
          description: null,
          risk_of_reversal: null,
          short_description: null,
        },
      ],
      availableTemplates: [],
      linkHints: [],
      isProduction: false,
      isConfigured: true,
    } satisfies FacilityCertifierMapping;

    const markup = renderToStaticMarkup(
      <FacilityCertifierForm
        facilityId="facility-1"
        loaderData={loaderData}
        presentation="inline"
      />,
    );

    expect(markup).toContain("Default Removal template");
    expect(markup).toContain("Isometric facility ID");
    expect(markup).toContain("Save changes");
  });
});
