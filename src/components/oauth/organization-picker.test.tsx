// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OrganizationPicker } from "./organization-picker";

const mocks = vi.hoisted(() => ({ choices: vi.fn(), mutateAsync: vi.fn(), assign: vi.fn() }));
vi.mock("@/hooks/use-oauth-flow", () => ({
  useOAuthOrganizationChoices: () => mocks.choices(),
  useSelectOAuthOrganization: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
}));
vi.mock("@/components/ui", async () => ({
  ...await import("@/components/ui/button"),
  ...await import("@/components/ui/empty-state"),
  ...await import("@/components/ui/notice"),
}));

const QUERY = "client_id=app&redirect_uri=https%3A%2F%2Fclient.test%2Fcb&sig=s&ba_param=redirect_uri";
const memberships = [
  { organizationId: "org-1", name: "E2E Mafinga Biochar", role: "admin", disabledReason: undefined },
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
  expect(screen.getByText("Admin")).toBeTruthy();
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
  expect(screen.getByRole("heading", { name: "No organizations yet" })).toBeTruthy();
  expect(screen.getByText("Ask an Admin to invite you.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
});

it("tells a Platform Admin without memberships to join an organization as a member", () => {
  mocks.choices.mockReturnValue(data({ memberships: [], preselectedOrganizationId: null, isPlatformAdmin: true }));
  render(<OrganizationPicker />);
  expect(screen.getByRole("heading", { name: "Join an organization first" })).toBeTruthy();
  expect(screen.getByText(/Apps connect as a member of an organization\. Platform Admins are not members/)).toBeTruthy();
  expect(screen.queryByText("Ask an Admin to invite you.")).toBeNull();
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

const continueButton = () => screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement;

it("stays busy with the choices disabled after the pick resolves and the page is leaving", async () => {
  mocks.choices.mockReturnValue(data());
  mocks.mutateAsync.mockResolvedValue("/oauth/consent?sig=next");
  render(<OrganizationPicker />);
  fireEvent.click(continueButton());
  await waitFor(() => expect(mocks.assign).toHaveBeenCalled());
  expect(continueButton().getAttribute("aria-busy")).toBe("true");
  expect((screen.getByRole("radio", { name: /E2E Mafinga Biochar/ }) as HTMLInputElement).disabled).toBe(true);
});

it("clears busy when the pick fails", async () => {
  mocks.choices.mockReturnValue(data());
  mocks.mutateAsync.mockRejectedValue(new Error("no"));
  render(<OrganizationPicker />);
  fireEvent.click(continueButton());
  await screen.findByText("Start again from the app.");
  expect(continueButton().getAttribute("aria-busy")).toBeNull();
  expect(continueButton().disabled).toBe(false);
});

const nonePicked = (overrides = {}) => data({ preselectedOrganizationId: null, ...overrides });

it("keeps Continue enabled with nothing preselected", () => {
  mocks.choices.mockReturnValue(nonePicked());
  render(<OrganizationPicker />);
  expect(continueButton().disabled).toBe(false);
});

it("asks for a choice, focuses the group and does not submit when nothing is picked", () => {
  mocks.choices.mockReturnValue(nonePicked());
  render(<OrganizationPicker />);
  fireEvent.click(continueButton());
  expect(screen.getByRole("alert").textContent).toBe("Choose an organization.");
  expect(mocks.mutateAsync).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(screen.getByRole("radio", { name: /E2E Mafinga Biochar/ }));
  expect(screen.getByRole("group").getAttribute("aria-invalid")).toBe("true");
});

it("clears the error when an organization is picked, then submits it", async () => {
  mocks.choices.mockReturnValue(nonePicked());
  mocks.mutateAsync.mockResolvedValue("/oauth/consent?sig=next");
  render(<OrganizationPicker />);
  fireEvent.click(continueButton());
  fireEvent.click(screen.getByRole("radio", { name: /E2E Second Organization/ }));
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.click(continueButton());
  await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledWith("org-2"));
});

it("shows a notice instead of Continue when every organization is unavailable", () => {
  const closed = memberships.map(membership => ({ ...membership, disabledReason: "API access is disabled for this organization." }));
  mocks.choices.mockReturnValue(nonePicked({ memberships: closed }));
  render(<OrganizationPicker />);
  expect(screen.getByText("None of your organizations can connect apps. Ask an Admin to turn on API access, then connect again.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
  expect(screen.queryByRole("radio")).toBeNull();
  expect(screen.getByRole("alert").getAttribute("data-tone")).toBe("error");
});

it("swaps to the notice when a refetch makes every organization unavailable after a pick", () => {
  mocks.choices.mockReturnValue(nonePicked());
  const { rerender } = render(<OrganizationPicker />);
  fireEvent.click(screen.getByRole("radio", { name: /E2E Second Organization/ }));
  const closed = memberships.map(membership => ({ ...membership, disabledReason: "API access is disabled for this organization." }));
  mocks.choices.mockReturnValue(nonePicked({ memberships: closed }));
  rerender(<OrganizationPicker />);
  expect(screen.getByText("None of your organizations can connect apps. Ask an Admin to turn on API access, then connect again.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
  expect(mocks.mutateAsync).not.toHaveBeenCalled();
});

it("does not fall back to the suggestion when the picked organization becomes unavailable", () => {
  mocks.choices.mockReturnValue(data());
  const { rerender } = render(<OrganizationPicker />);
  fireEvent.click(screen.getByRole("radio", { name: /E2E Mafinga Biochar/ }));
  const org1Closed = memberships.map(membership => membership.organizationId === "org-1" ? { ...membership, disabledReason: "API access is disabled for this organization." } : membership);
  mocks.choices.mockReturnValue(data({ memberships: org1Closed, preselectedOrganizationId: "org-2" }));
  rerender(<OrganizationPicker />);
  fireEvent.click(continueButton());
  expect(mocks.mutateAsync).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toBe("Choose an organization.");
});

it("drops the error line once an organization is chosen again", () => {
  mocks.choices.mockReturnValue(nonePicked());
  render(<OrganizationPicker />);
  fireEvent.click(continueButton());
  expect(screen.getByRole("alert")).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: /E2E Mafinga Biochar/ }));
  expect(screen.queryByRole("alert")).toBeNull();
});
