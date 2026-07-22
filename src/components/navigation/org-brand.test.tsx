import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrgBrand } from "./org-brand";

const state = vi.hoisted(() => ({
  isAdmin: false,
  session: {
    data: undefined as
      | { session: { activeOrganizationId: string | null } }
      | undefined,
    isPending: true,
  },
  activeProfile: {
    data: undefined as { id: string; name: string } | undefined,
    isPending: true,
  },
  memberOrganizations: {
    data: undefined as { id: string; name: string }[] | undefined,
    isPending: true,
  },
  allOrganizations: {
    data: undefined as { id: string; name: string }[] | undefined,
    isPending: true,
  },
}));

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock("@/lib/auth/client", () => ({
  authClient: {
    useSession: () => state.session,
    useListOrganizations: () => state.memberOrganizations,
  },
}));

vi.mock("@/hooks/use-is-admin", () => ({
  useIsAdmin: () => state.isAdmin,
}));

vi.mock("@/hooks/use-organizations", () => ({
  useActiveOrganizationProfile: () => state.activeProfile,
  useAllOrganizations: () => state.allOrganizations,
  useEnterOrganization: () => vi.fn(),
}));

describe("OrgBrand", () => {
  beforeEach(() => {
    state.isAdmin = false;
    state.session = { data: undefined, isPending: true };
    state.activeProfile = { data: undefined, isPending: true };
    state.memberOrganizations = { data: undefined, isPending: true };
    state.allOrganizations = { data: undefined, isPending: true };
  });

  it("renders a stable non-interactive shell while organization state loads", () => {
    const html = renderToStaticMarkup(<OrgBrand />);

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Loading organization"');
    expect(html).toContain("w-128");
    expect(html).not.toContain("w-112");
    expect(html).not.toContain("w-120");
    expect(html).not.toContain("noma dMRV");
    expect(html).not.toContain("<a");
    expect(html).not.toContain("<button");
  });

  it("settles to a dashboard link for one accessible organization", () => {
    state.session = {
      data: { session: { activeOrganizationId: "org-1" } },
      isPending: false,
    };
    state.activeProfile = {
      data: { id: "org-1", name: "Dark Earth Carbon" },
      isPending: false,
    };
    state.memberOrganizations = {
      data: [{ id: "org-1", name: "Dark Earth Carbon" }],
      isPending: false,
    };

    const html = renderToStaticMarkup(<OrgBrand />);

    expect(html).toContain('href="/dashboard"');
    expect(html).toContain("Dark Earth Carbon");
    expect(html).not.toContain('aria-haspopup="listbox"');
  });

  it("waits for and settles to the admin switcher for multiple organizations", () => {
    state.isAdmin = true;
    state.session = {
      data: { session: { activeOrganizationId: "org-1" } },
      isPending: false,
    };
    state.activeProfile = {
      data: { id: "org-1", name: "Dark Earth Carbon" },
      isPending: false,
    };
    state.memberOrganizations = { data: [], isPending: false };
    state.allOrganizations = {
      data: [
        { id: "org-1", name: "Dark Earth Carbon" },
        { id: "org-2", name: "Second Organization" },
      ],
      isPending: false,
    };

    const html = renderToStaticMarkup(<OrgBrand />);

    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain("Dark Earth Carbon");
    expect(html).not.toContain('role="status"');
  });
});
