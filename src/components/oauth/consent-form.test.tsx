// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConsentForm } from "./consent-form";

const mocks = vi.hoisted(() => ({ view: vi.fn(), mutateAsync: vi.fn(), assign: vi.fn() }));
vi.mock("@/hooks/use-oauth-flow", () => ({
  useOAuthConsentView: () => mocks.view(),
  useOAuthConsentDecision: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/components/forms", async () => ({ FormError: () => null }));
vi.mock("@/components/ui", async () => ({
  ...await import("@/components/ui/button"),
  ...await import("@/components/ui/notice"),
}));

const QUERY = "client_id=app&redirect_uri=https%3A%2F%2Fclient.test%2Fcb&sig=s&ba_param=redirect_uri";
const view = (overrides = {}) => ({ data: {
  clientName: "Claude", clientHost: "claude.ai", redirectHost: "claude.ai", organization: { id: "org-1", name: "E2E Mafinga Biochar" },
  newlyRequestedScopes: ["feedstocks:read", "orders:read"], alreadyAllowedScopes: [], offlineAccessRequested: true, isStepUp: false, ...overrides }, isError: false });
const box = (name: string) => screen.getByRole("checkbox", { name }) as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("location", { assign: mocks.assign, origin: "https://noma.test", search: `?${QUERY}` });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("asks first-time for reads only, with no delete column", () => {
  mocks.view.mockReturnValue(view({ newlyRequestedScopes: ["feedstocks:read", "feedstocks:write"] }));
  render(<ConsentForm />);
  expect(screen.getByRole("heading", { name: "Allow Claude to use noma?" })).toBeTruthy();
  expect(screen.getByText("Claude (claude.ai) wants to act for you in E2E Mafinga Biochar.")).toBeTruthy();
  expect(box("Feedstocks Read").checked).toBe(true);
  expect(box("Feedstocks Write").checked).toBe(false);
  expect(screen.queryByRole("columnheader", { name: "Delete" })).toBeNull();
  expect(box("Allow reading everything listed").checked).toBe(true);
});

it("ticks the newly requested writes on a step-up and shows the rest as already allowed", () => {
  mocks.view.mockReturnValue(view({ newlyRequestedScopes: ["feedstocks:write"], alreadyAllowedScopes: ["feedstocks:read"], isStepUp: true }));
  render(<ConsentForm />);
  expect(box("Feedstocks Write").checked).toBe(true);
  expect(screen.getByText("Already allowed")).toBeTruthy();
  expect(screen.getByText("Feedstocks: Read")).toBeTruthy();
  expect(screen.queryByRole("checkbox", { name: "Feedstocks Read" })).toBeNull();
});

const SEVENTEEN_READS = ["applications", "production-runs", "reactors", "biochar-products", "formulations", "feedstocks", "facilities", "suppliers",
  "customers", "orders", "deliveries", "feedstock-types", "storage-locations", "vehicles", "drivers", "lab-samples", "credit-batches"].map(entity => `${entity}:read`);

it("keeps the one newly requested write visible when 17 reads are already allowed, and collapses only the allowed group", () => {
  mocks.view.mockReturnValue(view({ newlyRequestedScopes: ["feedstocks:write"], alreadyAllowedScopes: SEVENTEEN_READS, isStepUp: true }));
  const { container } = render(<ConsentForm />);
  const write = box("Feedstocks Write");
  expect(write.checked).toBe(true);
  // The request is never inside a collapsible.
  expect(write.closest("details")).toBeNull();
  const allowed = container.querySelector("details") as HTMLDetailsElement;
  expect(allowed.open).toBe(false);
  expect(allowed.textContent).toContain("Already allowed (17)");
  expect(allowed.textContent).toContain("Applications: Read");
});

it("does not collapse a short already allowed group", () => {
  mocks.view.mockReturnValue(view({ newlyRequestedScopes: ["feedstocks:write"], alreadyAllowedScopes: ["feedstocks:read"], isStepUp: true }));
  const { container } = render(<ConsentForm />);
  expect(container.querySelector("details")).toBeNull();
});

it("disables Allow on a step-up until a newly requested scope is ticked", () => {
  mocks.view.mockReturnValue(view({ newlyRequestedScopes: ["feedstocks:write"], alreadyAllowedScopes: ["feedstocks:read"], isStepUp: true }));
  render(<ConsentForm />);
  fireEvent.click(box("Feedstocks Write"));
  expect((screen.getByRole("button", { name: "Allow" }) as HTMLButtonElement).disabled).toBe(true);
});

it("names an unnamed app in lowercase inside the title", () => {
  mocks.view.mockReturnValue(view({ clientName: null }));
  render(<ConsentForm />);
  expect(screen.getByRole("heading", { name: "Allow this app to use noma?" })).toBeTruthy();
  expect(screen.getByText(/^This app \(claude\.ai\) wants to act for you/)).toBeTruthy();
});

it("reads the signed query on the client only", () => {
  mocks.view.mockReturnValue({ data: undefined, isError: false });
  vi.stubGlobal("location", { assign: mocks.assign, origin: "https://noma.test", search: "" });
  render(<ConsentForm />);
  expect(screen.getByText("Start again from the app.")).toBeTruthy();
});

it("states the offline line only when offline access was requested", () => {
  mocks.view.mockReturnValue(view());
  const { unmount } = render(<ConsentForm />);
  expect(screen.getByText("Stay connected: Claude can keep working without asking you to sign in again")).toBeTruthy();
  expect(screen.queryByRole("checkbox", { name: /Stay connected/ })).toBeNull();
  unmount();
  mocks.view.mockReturnValue(view({ offlineAccessRequested: false }));
  render(<ConsentForm />);
  expect(screen.queryByText(/Stay connected/)).toBeNull();
});

it("links the footer to Connected apps", () => {
  mocks.view.mockReturnValue(view());
  render(<ConsentForm />);
  expect(screen.getByRole("link", { name: "Settings, Connected apps" }).getAttribute("href")).toBe("/settings/connected-apps");
});

it("disables Allow while nothing is ticked and re-enables it from the summary row", () => {
  mocks.view.mockReturnValue(view());
  render(<ConsentForm />);
  fireEvent.click(box("Allow reading everything listed"));
  expect((screen.getByRole("button", { name: "Allow" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(box("Allow reading everything listed"));
  expect((screen.getByRole("button", { name: "Allow" }) as HTMLButtonElement).disabled).toBe(false);
});

it("puts Allow before Deny", () => {
  mocks.view.mockReturnValue(view());
  render(<ConsentForm />);
  const labels = screen.getAllByRole("button").map(button => button.textContent);
  expect(labels.indexOf("Allow")).toBeLessThan(labels.indexOf("Deny"));
});

it("posts the ticked scopes plus offline_access and follows the callback", async () => {
  mocks.view.mockReturnValue(view());
  mocks.mutateAsync.mockResolvedValue("https://client.test/cb?code=c&iss=https%3A%2F%2Fnoma.test%2Fapi%2Fauth");
  render(<ConsentForm />);
  fireEvent.click(box("Orders Read"));
  fireEvent.click(screen.getByRole("button", { name: "Allow" }));
  await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledWith({ accept: true, scope: "feedstocks:read offline_access" }));
  await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith("https://client.test/cb?code=c&iss=https%3A%2F%2Fnoma.test%2Fapi%2Fauth"));
});

it("keeps the already allowed scopes in a step-up acceptance", async () => {
  mocks.view.mockReturnValue(view({ newlyRequestedScopes: ["feedstocks:write"], alreadyAllowedScopes: ["feedstocks:read"], isStepUp: true, offlineAccessRequested: false }));
  mocks.mutateAsync.mockResolvedValue("https://client.test/cb?code=c");
  render(<ConsentForm />);
  fireEvent.click(screen.getByRole("button", { name: "Allow" }));
  await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledWith({ accept: true, scope: "feedstocks:read feedstocks:write" }));
});

it("posts a denial without scopes and follows the callback", async () => {
  mocks.view.mockReturnValue(view());
  mocks.mutateAsync.mockResolvedValue("https://client.test/cb?error=access_denied");
  render(<ConsentForm />);
  fireEvent.click(screen.getByRole("button", { name: "Deny" }));
  await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledWith({ accept: false, scope: undefined }));
  await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith("https://client.test/cb?error=access_denied"));
});

it("refuses an unsafe redirect", async () => {
  mocks.view.mockReturnValue(view());
  mocks.mutateAsync.mockResolvedValue("https://evil.test/cb?code=c");
  render(<ConsentForm />);
  fireEvent.click(screen.getByRole("button", { name: "Allow" }));
  await screen.findByText("Start again from the app.");
  expect(mocks.assign).not.toHaveBeenCalled();
});

it("tells the person to start again when the request cannot be read", () => {
  mocks.view.mockReturnValue({ data: undefined, isError: true });
  render(<ConsentForm />);
  expect(screen.getByText("Start again from the app.")).toBeTruthy();
});

it("shows no Write column when only reads are requested", () => {
  mocks.view.mockReturnValue(view());
  render(<ConsentForm />);
  expect(screen.getByRole("columnheader", { name: "Read" })).toBeTruthy();
  expect(screen.queryByRole("columnheader", { name: "Write" })).toBeNull();
});
