// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OrganizationPicker } from "./organization-picker";

const mocks = vi.hoisted(() => ({ choices: vi.fn(), mutateAsync: vi.fn(), assign: vi.fn() }));
vi.mock("@/hooks/use-oauth-flow", () => ({
  useOAuthOrganizationChoices: () => mocks.choices(),
  useSelectOAuthOrganization: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
}));
vi.mock("@/components/forms", async () => ({
  ...await import("@/components/forms/choice-card-group"),
  ...await import("@/components/forms/server-error"),
}));
vi.mock("@/components/ui", async () => ({
  ...await import("@/components/ui/button"),
  ...await import("@/components/ui/empty-state"),
  ...await import("@/components/ui/notice"),
}));

const QUERY = "client_id=app&redirect_uri=https%3A%2F%2Fclient.test%2Fcb&sig=s&ba_param=redirect_uri";
const memberships = [
  { organizationId: "org-1", name: "E2E Mafinga Biochar", role: "owner", disabledReason: undefined },
  { organizationId: "org-2", name: "E2E Second Organization", role: "member", disabledReason: undefined },
  { organizationId: "org-3", name: "E2E Closed Organization", role: "admin", disabledReason: "API access is disabled for this organization." },
];
const data = (overrides = {}) => ({ data: { clientName: "Claude", clientHost: "claude.ai", redirectHost: "claude.ai", memberships, preselectedOrganizationId: "org-2", ...overrides }, isError: false });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("location", { assign: mocks.assign, origin: "https://noma.test", search: `?${QUERY}` });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("names the app, lists roles and preselects the suggested organization", () => {
  mocks.choices.mockReturnValue(data());
  render(<OrganizationPicker />);
  expect(screen.getByRole("heading", { name: "Choose an organization" })).toBeTruthy();
  expect(screen.getByText("Claude will act for you in one organization. To use another, connect again.")).toBeTruthy();
  expect(screen.getAllByText("claude.ai").length).toBeGreaterThan(0);
  expect(screen.getByText("Owner")).toBeTruthy();
  expect((screen.getByRole("radio", { name: /E2E Second Organization/ }) as HTMLInputElement).checked).toBe(true);
});

it("shows an organization with API access off as disabled, with the reason", () => {
  mocks.choices.mockReturnValue(data());
  render(<OrganizationPicker />);
  expect((screen.getByRole("radio", { name: /E2E Closed Organization/ }) as HTMLInputElement).disabled).toBe(true);
  const reason = screen.getByText(/API access is disabled for this organization\./);
  expect(reason.textContent).toBe("Admin. API access is disabled for this organization.");
  // The reason stays readable: nothing in its chain is dimmed with opacity.
  for (let node: HTMLElement | null = reason; node; node = node.parentElement) expect(node.className).not.toMatch(/opacity-/);
});

it("shows an empty state without memberships", () => {
  mocks.choices.mockReturnValue(data({ memberships: [], preselectedOrganizationId: null }));
  render(<OrganizationPicker />);
  expect(screen.getByText("You are not a member of an organization yet. Ask an Owner to invite you.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
});

it("submits the pick and follows a safe continuation", async () => {
  mocks.choices.mockReturnValue(data());
  mocks.mutateAsync.mockResolvedValue("/oauth/consent?sig=next");
  render(<OrganizationPicker />);
  fireEvent.click(screen.getByRole("radio", { name: /E2E Mafinga Biochar/ }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledWith("org-1"));
  await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith("https://noma.test/oauth/consent?sig=next"));
});

it.each(["https://evil.test/oauth/consent", "//evil.test"])("refuses an unsafe continuation %s", async url => {
  mocks.choices.mockReturnValue(data());
  mocks.mutateAsync.mockResolvedValue(url);
  render(<OrganizationPicker />);
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByText("Start again from the app.");
  expect(mocks.assign).not.toHaveBeenCalled();
});

it("tells the person to start again when the request cannot be read", () => {
  mocks.choices.mockReturnValue({ data: undefined, isError: true });
  render(<OrganizationPicker />);
  expect(screen.getByText("Start again from the app.")).toBeTruthy();
});

it("tells the person to start again when the pick fails", async () => {
  mocks.choices.mockReturnValue(data());
  mocks.mutateAsync.mockRejectedValue(new Error("Start again from the app."));
  render(<OrganizationPicker />);
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByText("Start again from the app.");
});
