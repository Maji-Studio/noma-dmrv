// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ModalProps } from "@/components/ui/modal";
import type { OAuthGrantListItem } from "@/hooks/use-oauth-grants";
import { StaleVersionError, STALE_VERSION_CONFLICT_CODE, STALE_VERSION_MESSAGE } from "@/lib/stale-version";
import { ConnectedApps } from "./connected-apps";

const mocks = vi.hoisted(() => ({ list: vi.fn(), revoke: vi.fn(), refetch: vi.fn() }));
vi.mock("@/hooks/use-oauth-grants", () => ({
  useOAuthGrants: () => mocks.list(),
  useRevokeOAuthGrant: () => ({ mutateAsync: mocks.revoke, isPending: false }),
}));
vi.mock("@/components/forms", async () => ({ ServerError: ({ message, action }: { message?: string; action?: React.ReactNode }) => <div role="alert">{message}{action}</div> }));
vi.mock("@/components/ui", async () => ({
  ...await import("@/components/ui/button"),
  ...await import("@/components/ui/empty-state"),
  ...await import("@/components/ui/notice"),
  Modal: ({ isOpen, children, ariaLabelledBy }: ModalProps) => isOpen ? <section role="dialog" aria-labelledby={ariaLabelledBy}>{children}</section> : null,
}));
vi.mock("@/components/ui/modal", () => ({
  Modal: ({ isOpen, children, ariaLabelledBy }: ModalProps) => isOpen ? <section role="dialog" aria-labelledby={ariaLabelledBy}>{children}</section> : null,
}));

const grant = (overrides: Partial<OAuthGrantListItem> = {}): OAuthGrantListItem => ({
  id: "grant-1", userId: "user-1", clientId: "https://claude.ai/oauth/metadata", name: "Claude", memberName: "E2E Member One",
  resource: "https://noma.test/api/mcp", scopes: ["feedstocks:read", "feedstocks:write", "offline_access"],
  createdAt: new Date("2026-10-01T10:00:00Z"), lastUsedAt: null, version: 3, ...overrides,
}) as OAuthGrantListItem;
const props = { organizationId: "org-1", organizationName: "E2E Mafinga Biochar", userId: "user-1", canManageAll: false, isMember: true };
const list = (data: OAuthGrantListItem[]) => mocks.list.mockReturnValue({ data, isLoading: false, isError: false, refetch: mocks.refetch });

beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);

it("shows a member only their own connections", () => {
  list([grant()]);
  render(<ConnectedApps {...props} />);
  const own = screen.getByRole("list", { name: "Your connections" });
  expect(within(own).getByText("Claude")).toBeTruthy();
  expect(within(own).getByText("claude.ai")).toBeTruthy();
  expect(within(own).getByText("Feedstocks: Read, Write", { exact: false })).toBeTruthy();
  expect(within(own).getByText("Not recorded")).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "All members" })).toBeNull();
});

it("adds an All members list with member names for Owners and Admins", () => {
  list([grant(), grant({ id: "grant-2", userId: "user-2", memberName: "E2E Member Two" })]);
  render(<ConnectedApps {...props} canManageAll />);
  const all = screen.getByRole("list", { name: "All members" });
  expect(within(all).getByText("E2E Member Two")).toBeTruthy();
  expect(within(screen.getByRole("list", { name: "Your connections" })).queryByText("E2E Member Two")).toBeNull();
});

it("shows an empty state for each empty list", () => {
  list([]);
  render(<ConnectedApps {...props} canManageAll />);
  expect(screen.getAllByText("No connected apps")).toHaveLength(2);
});

it("explains that platform admins without a membership have nothing to connect", () => {
  render(<ConnectedApps {...props} isMember={false} />);
  expect(screen.getByText(/Only members of this organization/)).toBeTruthy();
  expect(mocks.list).not.toHaveBeenCalled();
});

it("confirms before disconnecting and sends the loaded version", async () => {
  list([grant()]);
  mocks.revoke.mockResolvedValue({ id: "grant-1" });
  render(<ConnectedApps {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Disconnect Claude" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("Disconnect Claude? It stops working in E2E Mafinga Biochar at once. Records it saved stay.")).toBeTruthy();
  const labels = within(dialog).getAllByRole("button").map(button => button.textContent);
  expect(labels.indexOf("Disconnect")).toBeLessThan(labels.indexOf("Cancel"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Disconnect" }));
  await waitFor(() => expect(mocks.revoke).toHaveBeenCalledWith({ id: "grant-1", expectedVersion: 3 }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("shows the conflict message on a stale version and retries with the refreshed one", async () => {
  list([grant()]);
  mocks.revoke.mockRejectedValueOnce(new StaleVersionError(STALE_VERSION_MESSAGE, { entity: "oauth-grant", id: "grant-1", code: STALE_VERSION_CONFLICT_CODE }));
  const { rerender } = render(<ConnectedApps {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Disconnect Claude" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Disconnect" }));
  await screen.findByText(STALE_VERSION_MESSAGE);
  list([grant({ version: 4 })]);
  rerender(<ConnectedApps {...props} />);
  mocks.revoke.mockResolvedValueOnce({ id: "grant-1" });
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Disconnect" }));
  await waitFor(() => expect(mocks.revoke).toHaveBeenLastCalledWith({ id: "grant-1", expectedVersion: 4 }));
});

it("offers a retry when the list cannot be loaded", () => {
  mocks.list.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: mocks.refetch });
  render(<ConnectedApps {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(mocks.refetch).toHaveBeenCalled();
});

it("never says null for an app without a name", () => {
  list([grant({ name: null as unknown as string })]);
  render(<ConnectedApps {...props} />);
  expect(screen.getByRole("button", { name: "Disconnect this app" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Disconnect this app" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("Disconnect this app? It stops working in E2E Mafinga Biochar at once. Records it saved stay.")).toBeTruthy();
  expect(document.body.textContent).not.toContain("null");
});
