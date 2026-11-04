import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";
import { OrganizationDefaultsForm } from "./organization-defaults-form";

const queryState = vi.hoisted(() => ({
  error: new Error("background refresh failed") as Error | null,
  isLoading: false,
  data: {
    defaults: {
      defaultCountry: "Kenya",
      defaultTimezone: "Africa/Nairobi",
      defaultEvidenceMethod: "location" as const,
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

  it("splits what new facilities start with from what new records start with, without a currency field", () => {
    const html = renderToStaticMarkup(
      <ToastProvider>
        <OrganizationDefaultsForm />
      </ToastProvider>,
    );

    expect(html).toContain("New facilities start with");
    expect(html).toContain("New records");
    expect(html.indexOf("New facilities start with")).toBeLessThan(html.indexOf("Application evidence"));
    expect(html).toContain("Country");
    expect(html).toContain("Timezone");
    expect(html).not.toContain("Currency");
    expect(html).not.toContain("default-currency");
  });

  it("uses the canonical application evidence labels", () => {
    const html = renderToStaticMarkup(
      <ToastProvider>
        <OrganizationDefaultsForm />
      </ToastProvider>,
    );

    expect(html).toContain("Customer location");
    expect(html).toContain("GIS reference");
    expect(html).not.toContain("Visual evidence");
    expect(html).not.toContain("GIS boundary");
    expect(html).not.toMatch(/>Visual</);
  });

  it("shows a member the values without the controls", () => {
    queryState.data.viewerCanManage = false;
    try {
      const html = renderToStaticMarkup(
        <ToastProvider>
          <OrganizationDefaultsForm />
        </ToastProvider>,
      );

      expect(html).not.toContain("<form");
      expect(html).not.toContain("Save defaults");
      expect(html).toContain("New facilities start with");
      expect(html).toContain("Kenya");
      expect(html).toContain("Africa/Nairobi");
      expect(html).toContain("Customer location");
      expect(html).toContain("Bagged");
    } finally {
      queryState.data.viewerCanManage = true;
    }
  });
});
