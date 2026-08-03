import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";
import { OrganizationDefaultsForm } from "./organization-defaults-form";

const queryState = vi.hoisted(() => ({
  error: new Error("background refresh failed") as Error | null,
  isLoading: false,
  data: {
    defaults: {
      defaultCurrency: "KES",
      defaultCountry: "Kenya",
      defaultTimezone: "Africa/Nairobi",
      defaultTripType: "return" as const,
      defaultEvidenceMethod: "visual" as const,
      defaultPackaging: "bagged" as const,
    },
    viewerCanManage: true,
  },
}));

vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({ activeOrganizationId: "org-1" }),
}));

vi.mock("@/hooks/use-organization-settings", () => ({
  useOrganizationDefaults: () => queryState,
  useSaveOrganizationDefaults: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
}));

describe("OrganizationDefaultsForm", () => {
  it("keeps populated fields mounted when a background refresh fails", () => {
    const html = renderToStaticMarkup(
      <ToastProvider>
        <OrganizationDefaultsForm />
      </ToastProvider>,
    );

    expect(html).toContain("<form");
    expect(html).toContain("Save defaults");
    expect(html).not.toContain("Couldn&#x27;t load the operating defaults");
  });
});
