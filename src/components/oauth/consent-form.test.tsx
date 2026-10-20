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
  newlyRequestedScopes: ["feedstocks:read", "feedstocks:write", "orders:read"], alreadyAllowedScopes: [], offlineAccessRequested: true, isStepUp: false, stepUpScopes: [], ...overrides }, isError: false });
const box = (name: string) => screen.getByRole("checkbox", { name }) as HTMLInputElement;
const choose = (name: string) => fireEvent.click(screen.getByRole("radio", { name: new RegExp(`^${name}`) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("location", { assign: mocks.assign, origin: "https://noma.test", search: `?${QUERY}` });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("starts a first consent on Read only with the board closed", () => {
  mocks.view.mockReturnValue(view());
  render(<ConsentForm />);
  expect(screen.getByRole("heading", { name: "Allow Claude to use noma?" })).toBeTruthy();
  expect(screen.getByText("It wants to act for you in E2E Mafinga Biochar.")).toBeTruthy();
  // The card names the host the app identifies as and the one it returns to.
  expect(screen.getAllByText("claude.ai")).toHaveLength(2);
  expect((screen.getByRole("radio", { name: /^Read only/ }) as HTMLInputElement).checked).toBe(true);
  expect(screen.getByRole("radio", { name: /^Read and write/ })).toBeTruthy();
  expect(screen.getByRole("radio", { name: /^Choose per area/ })).toBeTruthy();
  expect(screen.queryByRole("table")).toBeNull();
});

it("omits Read and write when the request offers no write", () => {
  mocks.view.mockReturnValue(view({ newlyRequestedScopes: ["feedstocks:read", "orders:read"] }));
  render(<ConsentForm />);
  expect(screen.queryByRole("radio", { name: /^Read and write/ })).toBeNull();
});

it("cannot select or submit a write-only request without its read", () => {
  mocks.view.mockReturnValue(view({ newlyRequestedScopes: ["feedstocks:write"] }));
  render(<ConsentForm />);
  expect(screen.queryByRole("radio", { name: /^Read and write/ })).toBeNull();
  choose("Choose per area");
  expect(screen.queryByRole("checkbox", { name: "Feedstocks, write" })).toBeNull();
  expect(screen.queryByRole("checkbox", { name: "All areas, write" })).toBeNull();
  const allow = screen.getByRole("button", { name: "Allow" }) as HTMLButtonElement;
  expect(allow.disabled).toBe(true);
  fireEvent.click(allow);
  expect(mocks.mutateAsync).not.toHaveBeenCalled();
});

it("submits only writes with pegs for Read and write and All areas", async () => {
  mocks.view.mockReturnValue(view({ newlyRequestedScopes: ["feedstocks:write", "orders:read", "orders:write"] }));
  mocks.mutateAsync.mockResolvedValue("https://client.test/cb?code=c");
  render(<ConsentForm />);
  choose("Read and write");
  fireEvent.click(screen.getByRole("button", { name: "Allow" }));
  await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledWith({ accept: true, scope: "orders:read orders:write offline_access" }));
  mocks.mutateAsync.mockClear();
  choose("Choose per area");
  expect(screen.queryByRole("checkbox", { name: "Feedstocks, write" })).toBeNull();
  fireEvent.click(box("All areas, write"));
  fireEvent.click(box("All areas, write"));
  fireEvent.click(screen.getByRole("button", { name: "Allow" }));
  await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledExactlyOnceWith({ accept: true, scope: "orders:read orders:write offline_access" }));
});

it("ignores a refused lone write during step-up preselection", async () => {
  mocks.view.mockReturnValue(view({ newlyRequestedScopes: ["feedstocks:write"], alreadyAllowedScopes: ["orders:read"],
    isStepUp: true, stepUpScopes: ["feedstocks:write"] }));
  mocks.mutateAsync.mockResolvedValue("https://client.test/cb?code=c");
  render(<ConsentForm />);
  expect(screen.queryByRole("checkbox", { name: "Feedstocks, write" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Allow" }));
  await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledWith({ accept: true, scope: "orders:read offline_access" }));
});

it("submits reads only for the default Read only choice", async () => {
  mocks.view.mockReturnValue(view());
  mocks.mutateAsync.mockResolvedValue("https://client.test/cb?code=c&iss=https%3A%2F%2Fnoma.test%2Fapi%2Fauth");
  render(<ConsentForm />);
  fireEvent.click(screen.getByRole("button", { name: "Allow" }));
  await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledWith({ accept: true, scope: "feedstocks:read orders:read offline_access" }));
  await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith("https://client.test/cb?code=c&iss=https%3A%2F%2Fnoma.test%2Fapi%2Fauth"));
});

it("submits every offered scope for Read and write", async () => {
  mocks.view.mockReturnValue(view());
  mocks.mutateAsync.mockResolvedValue("https://client.test/cb?code=c");
  render(<ConsentForm />);
  choose("Read and write");
  fireEvent.click(screen.getByRole("button", { name: "Allow" }));
  await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledWith({ accept: true, scope: "feedstocks:read feedstocks:write orders:read offline_access" }));
});

it("opens the per-area board from the current choice and links write to read", () => {
  mocks.view.mockReturnValue(view());
  render(<ConsentForm />);
  choose("Choose per area");
  expect(box("Feedstocks, read").checked).toBe(true);
  expect(box("Feedstocks, write").checked).toBe(false);
  // Areas without a write scope show only the read peg.
  expect(screen.queryByRole("checkbox", { name: "Orders, write" })).toBeNull();
  expect(screen.queryByRole("columnheader", { name: "Delete" })).toBeNull();
  fireEvent.click(box("Feedstocks, read"));
  fireEvent.click(box("Feedstocks, write"));
  expect(box("Feedstocks, read").checked).toBe(true);
  expect(box("Feedstocks, write").checked).toBe(true);
  fireEvent.click(box("Feedstocks, read"));
  expect(box("Feedstocks, read").checked).toBe(false);
  expect(box("Feedstocks, write").checked).toBe(false);
});

it("All areas, write turns every offered write on and its read with it", async () => {
  mocks.view.mockReturnValue(view());
  mocks.mutateAsync.mockResolvedValue("https://client.test/cb?code=c");
  render(<ConsentForm />);
  choose("Choose per area");
  fireEvent.click(box("All areas, read"));
  expect(box("Orders, read").checked).toBe(false);
  fireEvent.click(box("All areas, write"));
  expect(box("Feedstocks, read").checked).toBe(true);
  expect(box("Feedstocks, write").checked).toBe(true);
  expect(box("Orders, read").checked).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Allow" }));
  await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledWith({ accept: true, scope: "feedstocks:write feedstocks:read offline_access" }));
});

it("preticks only the refused write on a step-up, listed first with New", () => {
  mocks.view.mockReturnValue(view({ newlyRequestedScopes: ["feedstocks:write", "orders:write", "orders:read", "lab-samples:write", "lab-samples:read"],
    alreadyAllowedScopes: ["feedstocks:read"], isStepUp: true, stepUpScopes: ["lab-samples:write"] }));
  render(<ConsentForm />);
  expect(screen.queryByRole("radio")).toBeNull();
  expect(box("Lab samples, write").checked).toBe(true);
  // The refused write needs its read, so the read is on too.
  expect(box("Lab samples, read").checked).toBe(true);
  expect(box("Orders, write").checked).toBe(false);
  expect(box("Orders, read").checked).toBe(false);
  expect(screen.queryByRole("checkbox", { name: "Feedstocks, read" })).toBeNull();
  expect(screen.getByText("Feedstocks, read, already allowed")).toBeTruthy();
  const rows = screen.getAllByRole("row").map(row => row.textContent ?? "");
  const labs = rows.findIndex(text => text.startsWith("Lab samples"));
  expect(rows[labs]).toContain("New");
  expect(labs).toBeLessThan(rows.findIndex(text => text.startsWith("Feedstocks")));
  expect(labs).toBeLessThan(rows.findIndex(text => text.startsWith("Orders")));
  expect(screen.getAllByText("New")).toHaveLength(1);
});

it("shows the board with nothing new ticked and no New row when a step-up has no refusal", () => {
  mocks.view.mockReturnValue(view({ newlyRequestedScopes: ["feedstocks:write", "orders:read"],
    alreadyAllowedScopes: ["feedstocks:read"], isStepUp: true, stepUpScopes: [] }));
  render(<ConsentForm />);
  expect(box("Feedstocks, write").checked).toBe(false);
  expect(box("Orders, read").checked).toBe(false);
  expect(screen.queryByText("New")).toBeNull();
});

it("keeps Allow enabled when existing permissions remain after unticking new scopes", () => {
  mocks.view.mockReturnValue(view({ newlyRequestedScopes: ["feedstocks:write"], alreadyAllowedScopes: ["feedstocks:read"], isStepUp: true, stepUpScopes: ["feedstocks:write"] }));
  render(<ConsentForm />);
  fireEvent.click(box("Feedstocks, write"));
  expect((screen.getByRole("button", { name: "Allow" }) as HTMLButtonElement).disabled).toBe(false);
});

it("names an unnamed app in lowercase inside the title", () => {
  mocks.view.mockReturnValue(view({ clientName: null }));
  render(<ConsentForm />);
  expect(screen.getByRole("heading", { name: "Allow this app to use noma?" })).toBeTruthy();
  expect(screen.getByText("This app")).toBeTruthy();
  // The card names the host the app identifies as and the one it returns to.
  expect(screen.getAllByText("claude.ai")).toHaveLength(2);
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


it("puts Allow before Deny", () => {
  mocks.view.mockReturnValue(view());
  render(<ConsentForm />);
  const labels = screen.getAllByRole("button").map(button => button.textContent);
  expect(labels.indexOf("Allow")).toBeLessThan(labels.indexOf("Deny"));
});


it("keeps the already allowed scopes in a step-up acceptance", async () => {
  mocks.view.mockReturnValue(view({ newlyRequestedScopes: ["feedstocks:write"], alreadyAllowedScopes: ["feedstocks:read"], isStepUp: true, stepUpScopes: ["feedstocks:write"], offlineAccessRequested: false }));
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


it("accepts forced re-consent when every requested scope is already allowed", async () => {
  mocks.view.mockReturnValue(view({ newlyRequestedScopes: [], alreadyAllowedScopes: ["feedstocks:read"] }));
  vi.stubGlobal("location", { assign: mocks.assign, origin: "https://noma.test", search: `?${QUERY}&prompt=consent` });
  mocks.mutateAsync.mockResolvedValue("https://client.test/cb?code=c");
  render(<ConsentForm />);
  expect((screen.getByRole("button", { name: "Allow" }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Allow" }));
  await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledWith({ accept: true, scope: "feedstocks:read offline_access" }));
});


it("disables Allow when a first consent ticks nothing", () => {
  mocks.view.mockReturnValue(view());
  render(<ConsentForm />);
  choose("Choose per area");
  fireEvent.click(box("All areas, read"));
  expect((screen.getByRole("button", { name: "Allow" }) as HTMLButtonElement).disabled).toBe(true);
});

it("keeps the already allowed scopes and ticks a refused write on a discovery re-ask", async () => {
  mocks.view.mockReturnValue(view({ newlyRequestedScopes: ["feedstocks:write", "orders:write", "orders:read"],
    alreadyAllowedScopes: ["feedstocks:read"], isStepUp: true, stepUpScopes: ["feedstocks:write"] }));
  mocks.mutateAsync.mockResolvedValue("https://client.test/cb?code=c");
  render(<ConsentForm />);
  fireEvent.click(screen.getByRole("button", { name: "Allow" }));
  await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledWith({ accept: true, scope: "feedstocks:read feedstocks:write offline_access" }));
});
