// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformOrganizations } from "./platform-organizations";

const state = vi.hoisted(() => ({
  enter: vi.fn(),
  push: vi.fn(),
  toastError: vi.fn(),
  currentId: "org-current" as string | null,
}));

const DIRECTORY = [
  { id: "org-current", name: "Dark Earth Carbon", memberCount: 3, adminCount: 1, isometricKeysSaved: true, apiAccessEnabled: true },
  { id: "org-other", name: "Kilombero Carbon", memberCount: 4, adminCount: 2, isometricKeysSaved: true, apiAccessEnabled: false },
  { id: "org-empty", name: "Rukwa Soil Trust", memberCount: 0, adminCount: 0, isometricKeysSaved: false, apiAccessEnabled: true },
];

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("@/hooks/use-organizations", () => ({
  ORG_SWITCH_FAILED_MESSAGE: "The organization did not open. Try again.",
  usePlatformOrganizations: () => ({ data: DIRECTORY, isLoading: false, isError: false }),
  useEnterOrganization: () => state.enter,
  useCreateOrganization: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSetOrganizationApiAccess: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: vi.fn(), error: state.toastError }),
}));
vi.mock("@/components/navigation", () => ({
  useViewerOrg: () => (state.currentId ? { organizationId: state.currentId } : null),
}));
// The keys form has its own suite; here it only has to be there.
vi.mock("./organization-certifier-credentials", () => ({
  OrganizationCertifierCredentials: ({ organizationName }: { organizationName: string }) => <p>Keys form for {organizationName}</p>,
}));

function renderAt(org?: string) {
  return render(
    <NuqsTestingAdapter searchParams={org ? { org } : {}}>
      <PlatformOrganizations />
    </NuqsTestingAdapter>,
  );
}

const panel = (name: string) => screen.getByRole("article", { name });

beforeEach(() => {
  state.enter = vi.fn();
  state.push = vi.fn();
  state.toastError = vi.fn();
  state.currentId = "org-current";
});
afterEach(() => cleanup());

describe("PlatformOrganizations", () => {
  it("asks to pick an organization until one is picked, and marks the ones that need setup", () => {
    renderAt();
    expect(screen.getByText("Pick an organization")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Needs setup: no Isometric keys, no members" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Organizations" }).textContent).toContain("Current · 3 members");
  });

  it("offers Switch to <name> for another organization and switches to its dashboard", async () => {
    state.enter.mockReturnValue(new Promise(() => {}));
    renderAt("org-other");
    const detail = panel("Kilombero Carbon");
    fireEvent.click(within(detail).getByRole("button", { name: "Switch to Kilombero Carbon" }));
    await waitFor(() => expect(state.enter).toHaveBeenCalledWith("org-other", "Kilombero Carbon", undefined));
    expect(within(detail).getByRole("button", { name: "Switching…" })).toBeTruthy();
  });

  it("says you're working in the current organization instead of offering a switch", () => {
    renderAt("org-current");
    const detail = panel("Dark Earth Carbon");
    expect(within(detail).getByText("You're working in Dark Earth Carbon.")).toBeTruthy();
    expect(within(detail).queryByRole("button", { name: /^Switch to/ })).toBeNull();
  });

  it("opens Members directly for the current organization", () => {
    renderAt("org-current");
    fireEvent.click(within(panel("Dark Earth Carbon")).getByRole("button", { name: "Manage members" }));
    expect(state.push).toHaveBeenCalledWith("/settings/members");
    expect(state.enter).not.toHaveBeenCalled();
  });

  it("switches first, and says so, before opening another organization's Members", async () => {
    state.enter.mockReturnValue(new Promise(() => {}));
    renderAt("org-other");
    const detail = panel("Kilombero Carbon");
    expect(within(detail).getByText("4 members, 2 Admins")).toBeTruthy();
    expect(within(detail).getByText("Switches you to Kilombero Carbon, then opens Settings, Members.")).toBeTruthy();
    fireEvent.click(within(detail).getByRole("button", { name: "Manage members" }));
    await waitFor(() => expect(state.enter).toHaveBeenCalledWith("org-other", "Kilombero Carbon", "/settings/members"));
  });

  it("offers Invite members for an organization with nobody in it", () => {
    renderAt("org-empty");
    const detail = panel("Rukwa Soil Trust");
    expect(within(detail).getByText("No members yet. Nobody can sign in to this organization.")).toBeTruthy();
    expect(within(detail).getByRole("button", { name: "Invite members" })).toBeTruthy();
  });

  it("releases the switch and shows the error when it fails", async () => {
    state.enter.mockResolvedValue({ success: false, error: "No access" });
    renderAt("org-other");
    fireEvent.click(within(panel("Kilombero Carbon")).getByRole("button", { name: "Switch to Kilombero Carbon" }));
    await waitFor(() => expect(state.toastError).toHaveBeenCalledWith("No access"));
    expect(within(panel("Kilombero Carbon")).getByRole("button", { name: "Switch to Kilombero Carbon" })).toBeTruthy();
  });

  it("filters the list by name", () => {
    renderAt();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search organizations" }), { target: { value: "rukwa" } });
    const list = screen.getByRole("navigation", { name: "Organizations" });
    expect(within(list).getByText("Rukwa Soil Trust")).toBeTruthy();
    expect(within(list).queryByText("Kilombero Carbon")).toBeNull();
  });

  it("opens the create form for ?org=new", () => {
    renderAt("new");
    expect(screen.getByRole("heading", { name: "New organization" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: /First Admin/ })).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: /Slug/ })).toBeNull();
  });
});
