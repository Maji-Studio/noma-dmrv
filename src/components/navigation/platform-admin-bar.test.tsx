import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformAdminBar } from "./platform-admin-bar";
import { ViewerOrgProvider } from "./viewer-org";
import type { ViewerOrg } from "./viewer-org-rules";

const state = vi.hoisted(() => ({
  sessionOrganizationId: null as string | null,
  pathname: "/dashboard",
}));

vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));
vi.mock("@/lib/auth/client", () => ({
  authClient: {
    useSession: () => ({
      data: state.sessionOrganizationId
        ? { session: { activeOrganizationId: state.sessionOrganizationId } }
        : undefined,
    }),
  },
}));

const outsider: ViewerOrg = {
  organizationId: "org-1",
  organizationName: "Mafinga Biochar",
  orgRole: null,
  isPlatformAdmin: true,
};

function render(viewer: ViewerOrg | null) {
  return renderToStaticMarkup(
    <ViewerOrgProvider value={viewer}>
      <PlatformAdminBar />
    </ViewerOrgProvider>,
  );
}

beforeEach(() => {
  state.sessionOrganizationId = null;
  state.pathname = "/dashboard";
});

describe("PlatformAdminBar", () => {
  it("is a labelled region naming the organization with a way back", () => {
    const html = render(outsider);

    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="Platform Admin"');
    expect(html).toContain("Platform Admin in");
    expect(html).toContain("Mafinga Biochar");
    expect(html).toContain('href="/admin/organizations"');
    expect(html).toContain("Back to Platform");
  });

  it("is absent for a Platform Admin who is also a member", () => {
    expect(render({ ...outsider, orgRole: "admin" })).toBe("");
  });

  it("is absent for members and without a viewer", () => {
    expect(render({ ...outsider, orgRole: "member", isPlatformAdmin: false })).toBe("");
    expect(render(null)).toBe("");
  });

  it("is absent on the Platform home it links back to", () => {
    state.pathname = "/admin/organizations";

    expect(render(outsider)).toBe("");
  });

  it("claims nothing while another tab has switched the session organization", () => {
    state.sessionOrganizationId = "org-2";

    expect(render(outsider)).toBe("");
  });
});
