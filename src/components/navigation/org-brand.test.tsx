// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUnsavedPaneGuard } from "@/components/certification/use-unsaved-pane-guard";
import { ORG_SWITCH_DISCARD_DESCRIPTION } from "@/lib/org-switch-notice";
import { OrgBrand } from "./org-brand";
import { ViewerOrgProvider } from "./viewer-org";
import type { ViewerOrg } from "./viewer-org-rules";

const state = vi.hoisted(() => ({
  enter: vi.fn(),
  toastError: vi.fn(),
  isAdmin: false,
  session: {
    data: undefined as
      | { session: { activeOrganizationId: string | null } }
      | undefined,
    isPending: true,
    error: undefined as unknown,
  } as {
    data?: { session: { activeOrganizationId: string | null } };
    isPending: boolean;
    error?: unknown;
  },
  activeProfile: {
    data: undefined as { id: string; name: string } | undefined,
    isPending: true,
    error: undefined as unknown,
  } as {
    data?: { id: string; name: string };
    isPending: boolean;
    error?: unknown;
  },
  memberOrganizations: {
    data: undefined as { id: string; name: string }[] | undefined,
    isPending: true,
    error: undefined as unknown,
  } as {
    data?: { id: string; name: string }[];
    isPending: boolean;
    error?: unknown;
  },
  allOrganizations: {
    data: undefined as { id: string; name: string }[] | undefined,
    isPending: true,
    error: undefined as unknown,
  } as {
    data?: { id: string; name: string }[];
    isPending: boolean;
    error?: unknown;
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

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ error: state.toastError }),
}));

vi.mock("@/hooks/use-is-admin", () => ({
  useIsAdmin: () => state.isAdmin,
}));

vi.mock("@/hooks/use-organizations", () => ({
  useActiveOrganizationProfile: () => state.activeProfile,
  useAllOrganizations: () => state.allOrganizations,
  useEnterOrganization: () => state.enter,
}));

describe("OrgBrand", () => {
  beforeEach(() => {
    state.enter = vi.fn();
    state.toastError = vi.fn();
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

  it("treats a terminal query error as settled and renders the best fallback", () => {
    state.session = {
      data: { session: { activeOrganizationId: "org-1" } },
      isPending: false,
    };
    state.activeProfile = {
      data: undefined,
      isPending: true,
      error: new Error("profile unavailable"),
    };
    state.memberOrganizations = {
      data: [{ id: "org-1", name: "Dark Earth Carbon" }],
      isPending: false,
    };

    const html = renderToStaticMarkup(<OrgBrand />);

    expect(html).toContain('href="/dashboard"');
    expect(html).toContain("Dark Earth Carbon");
    expect(html).not.toContain('role="status"');
  });

  it("settles to a dashboard link for an admin with one organization", () => {
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

  describe("role chip", () => {
    function settle(viewer: ViewerOrg, orgs: { id: string; name: string }[]) {
      state.isAdmin = viewer.isPlatformAdmin;
      state.session = { data: { session: { activeOrganizationId: viewer.organizationId } }, isPending: false };
      state.activeProfile = {
        data: { id: viewer.organizationId, name: viewer.organizationName },
        isPending: false,
      };
      state.memberOrganizations = { data: viewer.isPlatformAdmin ? [] : orgs, isPending: false };
      state.allOrganizations = { data: orgs, isPending: false };
      return renderToStaticMarkup(
        <ViewerOrgProvider value={viewer}>
          <OrgBrand />
        </ViewerOrgProvider>,
      );
    }
    const base = { organizationId: "org-1", organizationName: "Dark Earth Carbon" };
    const one = [{ id: "org-1", name: "Dark Earth Carbon" }];
    const two = [...one, { id: "org-2", name: "Second Organization" }];

    it("shows the member's role on the plain header", () => {
      const html = settle({ ...base, orgRole: "member", isPlatformAdmin: false }, one);

      expect(html).toContain("Member");
      expect(html).toContain('href="/dashboard"');
      expect(html).not.toContain('aria-haspopup="listbox"');
    });

    it("shows Admin and keeps the switcher for a member of several organizations", () => {
      const html = settle({ ...base, orgRole: "admin", isPlatformAdmin: false }, two);

      expect(html).toContain("Admin");
      expect(html).toContain('aria-haspopup="listbox"');
    });

    it("shows no chip for a Platform Admin without a membership (the bar says it)", () => {
      const html = settle({ ...base, orgRole: null, isPlatformAdmin: true }, two);

      expect(html).not.toContain("Platform Admin");
      expect(html).toContain('aria-haspopup="listbox"');
    });
  });

  describe("switching organizations", () => {
    function openPicker() {
      state.session = { data: { session: { activeOrganizationId: "org-1" } }, isPending: false };
      state.activeProfile = { data: { id: "org-1", name: "Dark Earth Carbon" }, isPending: false };
      state.memberOrganizations = {
        data: [
          { id: "org-1", name: "Dark Earth Carbon" },
          { id: "org-2", name: "Second Organization" },
          { id: "org-3", name: "Third Organization" },
        ],
        isPending: false,
      };
      render(<OrgBrand />);
      fireEvent.click(screen.getByRole("button", { name: /Dark Earth Carbon/ }));
    }
    const option = (name: string) => screen.getByRole("option", { name }) as HTMLButtonElement;
    afterEach(() => cleanup());

    it("stays switching after a successful pick and ignores a second pick", async () => {
      state.enter.mockResolvedValue({ success: true });
      openPicker();

      fireEvent.click(option("Second Organization"));
      await waitFor(() => expect(screen.getByText("Switching…")).toBeTruthy());
      // The page is still unloading: the trigger stays disabled and the list stays locked.
      expect((screen.getByRole("button", { name: /Switching/ }) as HTMLButtonElement).disabled).toBe(true);

      fireEvent.click(screen.getByRole("button", { name: /Switching/ }));
      expect(state.enter).toHaveBeenCalledTimes(1);
    });

    it("marks the picked organization busy and leaves the others plainly disabled", async () => {
      state.enter.mockReturnValue(new Promise(() => {}));
      openPicker();

      fireEvent.click(option("Second Organization"));

      await waitFor(() => expect(option("Second Organization").getAttribute("aria-busy")).toBe("true"));
      expect(option("Second Organization").querySelector(".animate-spin")).not.toBeNull();
      expect(option("Second Organization").className).not.toContain("disabled:opacity-40");
      expect(option("Third Organization").getAttribute("aria-busy")).toBeNull();
      expect(option("Third Organization").querySelector(".animate-spin")).toBeNull();
      expect(option("Third Organization").className).toContain("disabled:opacity-40");
    });

    it("disables the other options while a switch is held and ignores clicks on them", async () => {
      state.enter.mockReturnValue(new Promise(() => {}));
      openPicker();

      fireEvent.click(option("Second Organization"));
      await waitFor(() => expect(option("Third Organization").disabled).toBe(true));
      fireEvent.click(option("Third Organization"));
      expect(state.enter).toHaveBeenCalledTimes(1);
      expect(state.enter).toHaveBeenCalledWith("org-2", "Second Organization");
    });

    it("shows a toast and re-enables the picker when the switch throws", async () => {
      state.enter.mockRejectedValue(new Error("network"));
      openPicker();

      fireEvent.click(option("Second Organization"));
      await waitFor(() =>
        expect(state.toastError).toHaveBeenCalledWith("Second Organization did not open. Try again."),
      );
      expect(option("Third Organization").disabled).toBe(false);
      expect(screen.queryByText("Switching…")).toBeNull();
    });

    it("re-enables the picker when the switch reports failure", async () => {
      state.enter.mockResolvedValue({ success: false, error: "No access" });
      openPicker();

      fireEvent.click(option("Second Organization"));
      await waitFor(() => expect(option("Third Organization").disabled).toBe(false));
      expect(screen.queryByText("Switching…")).toBeNull();
      expect(state.toastError).toHaveBeenCalledWith("Second Organization did not open. No access");
    });
  });
  describe("with unsaved changes in the open pane", () => {
    function PaneWithDraft({ dirty }: { dirty: boolean }) {
      const guard = useUnsavedPaneGuard();
      return (
        <>
          <button
            type="button"
            onClick={() => guard.actions.report({}, { dirty, busy: false })}
          >
            Edit pane
          </button>
          <OrgBrand />
          {guard.dialog}
        </>
      );
    }
    function openPickerWith(dirty: boolean) {
      state.session = { data: { session: { activeOrganizationId: "org-1" } }, isPending: false };
      state.activeProfile = { data: { id: "org-1", name: "Dark Earth Carbon" }, isPending: false };
      state.memberOrganizations = {
        data: [
          { id: "org-1", name: "Dark Earth Carbon" },
          { id: "org-2", name: "Second Organization" },
        ],
        isPending: false,
      };
      render(<PaneWithDraft dirty={dirty} />);
      fireEvent.click(screen.getByRole("button", { name: "Edit pane" }));
      fireEvent.click(screen.getByRole("button", { name: /Dark Earth Carbon/ }));
      fireEvent.click(screen.getByRole("option", { name: "Second Organization" }));
    }
    afterEach(() => cleanup());

    it("asks first and does not call the server action", async () => {
      openPickerWith(true);

      expect(await screen.findByText(ORG_SWITCH_DISCARD_DESCRIPTION)).toBeTruthy();
      expect(state.enter).not.toHaveBeenCalled();
      expect(screen.queryByText("Switching…")).toBeNull();
    });

    it("switches after Discard changes", async () => {
      state.enter.mockReturnValue(new Promise(() => {}));
      openPickerWith(true);

      fireEvent.click(await screen.findByRole("button", { name: "Discard changes" }));

      await waitFor(() => expect(state.enter).toHaveBeenCalledWith("org-2", "Second Organization"));
      expect(screen.getByText("Switching…")).toBeTruthy();
    });

    it("stays in the old organization on Keep editing, with the switcher back to normal", async () => {
      openPickerWith(true);

      fireEvent.click(await screen.findByRole("button", { name: "Keep editing" }));

      await waitFor(() => expect(screen.queryByText(ORG_SWITCH_DISCARD_DESCRIPTION)).toBeNull());
      expect(state.enter).not.toHaveBeenCalled();
      expect(screen.queryByText("Switching…")).toBeNull();
      expect((screen.getByRole("button", { name: /Dark Earth Carbon/ }) as HTMLButtonElement).disabled).toBe(false);
    });

    it("switches directly when nothing is unsaved", async () => {
      state.enter.mockReturnValue(new Promise(() => {}));
      openPickerWith(false);

      await waitFor(() => expect(state.enter).toHaveBeenCalledWith("org-2", "Second Organization"));
      expect(screen.queryByText("Discard unsaved changes?")).toBeNull();
    });
  });
});
