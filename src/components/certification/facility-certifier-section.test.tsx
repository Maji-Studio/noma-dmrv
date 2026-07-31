import { renderToStaticMarkup } from "react-dom/server";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FacilityCertifierMapping } from "@/fn/certification/facility-mapping";
import { useFacilityCertifierMapping } from "@/hooks/use-certification";
import { FacilityCertifierForm } from "./facility-certifier-dialog";
import { FacilityCertifierSection } from "./facility-certifier-section";

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: vi.fn() }),
}));

vi.mock("@/components/forms", async () => {
  const { forwardRef } = await import("react");
  return {
    FormActions: ({
      submitDisabled,
      submitLabel,
    }: {
      submitDisabled?: boolean;
      submitLabel?: string;
    }) => <button disabled={submitDisabled}>{submitLabel}</button>,
    FormField: ({
      label,
      children,
    }: {
      label: string;
      children: React.ReactNode;
    }) => (
      <label>
        {label}
        {children}
      </label>
    ),
    FormInput: forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
      (props, ref) => <input ref={ref} {...props} />,
    ),
    FormSelect: forwardRef<
      HTMLSelectElement,
      React.SelectHTMLAttributes<HTMLSelectElement> & {
        options: readonly { value: string; label: string }[];
        placeholder?: string;
      }
    >(({ options, placeholder, ...props }, ref) => (
      <select ref={ref} {...props}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    )),
  };
});

const saveMapping = vi.fn();

vi.mock("@/hooks/use-certification", () => ({
  useFacilityCertifierMapping: vi.fn(() => ({
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
  })),
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
    mutateAsync: saveMapping,
    isPending: false,
  }),
}));

beforeAll(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  saveMapping.mockReset();
});

describe("FacilityCertifierSection", () => {
  it("keeps the disabled link action visible until a project is selected", () => {
    const markup = renderToStaticMarkup(
      <FacilityCertifierSection
        facilityId="facility-1"
        canManage
        embedded
        linkPresentation="inline"
      />,
    );

    expect(markup).toContain("Select a project");
    expect(markup).toContain(">Link project<");
    expect(markup).toContain("disabled");
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

  it("restores persisted project fields after switching away and back", async () => {
    const facilityId = "11111111-1111-4111-8111-111111111111";
    const loaderData = {
      mapping: {
        externalProjectId: "prj_saved",
        protocolSlug: "biochar",
        defaultRemovalTemplateId: "tpl_saved",
        externalFacilityId: "fcl_saved",
      } as NonNullable<FacilityCertifierMapping["mapping"]>,
      availableProjects: [
        {
          id: "prj_saved",
          name: "Saved project",
          country_code: "TZ",
          description: null,
          risk_of_reversal: null,
          short_description: null,
        },
        {
          id: "prj_other",
          name: "Other project",
          country_code: "TZ",
          description: null,
          risk_of_reversal: null,
          short_description: null,
        },
      ],
      availableTemplates: [
        ({
          id: "tpl_saved",
          display_name: "Saved template",
          credit_type: "REMOVAL" as const,
        } as FacilityCertifierMapping["availableTemplates"][number]),
      ],
      linkHints: [],
      isProduction: false,
      isConfigured: true,
    } as FacilityCertifierMapping;
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(
        <FacilityCertifierForm
          facilityId={facilityId}
          loaderData={loaderData}
          presentation="inline"
        />,
        {
          createNodeMock: (element) => ({
            ...(element.props as Record<string, unknown>),
            focus: () => undefined,
            select: () => undefined,
            setCustomValidity: () => undefined,
            reportValidity: () => true,
          }),
        },
      );
    });

    const changeProject = async (value: string) => {
      const select = renderer?.root
        .findAllByType("select")
        .find((node) => node.props.id === "externalProjectId");
      await act(async () => {
        select?.props.onChange({
          target: { name: "externalProjectId", type: "select-one", value },
        });
      });
    };

    await changeProject("prj_other");
    await changeProject("prj_saved");
    const form = renderer?.root.findByType("form");
    await act(async () => {
      await form?.props.onSubmit({
        preventDefault: () => undefined,
        persist: () => undefined,
      });
    });

    expect(saveMapping).toHaveBeenCalledWith(
      expect.objectContaining({
        facilityId,
        externalProjectId: "prj_saved",
        defaultRemovalTemplateId: "tpl_saved",
        externalFacilityId: "fcl_saved",
      }),
    );

    await act(async () => {
      renderer?.unmount();
    });
  });

  it("hides inline Edit when registry keys are not configured", () => {
    vi.mocked(useFacilityCertifierMapping).mockReturnValueOnce({
      data: {
        mapping: {
          externalProjectId: "prj_test",
          protocolSlug: "biochar",
          defaultRemovalTemplateId: null,
          externalFacilityId: null,
        },
        availableProjects: [],
        availableTemplates: [],
        linkHints: [],
        isProduction: false,
        isConfigured: false,
      },
      isLoading: false,
      error: null,
    } as never);

    const markup = renderToStaticMarkup(
      <FacilityCertifierSection
        facilityId="facility-1"
        canManage
        embedded
        linkPresentation="inline"
      />,
    );

    expect(markup).not.toContain(">Edit<");
    expect(markup).toContain("prj_test");
  });
});
