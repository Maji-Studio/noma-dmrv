import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), getSession: vi.fn(), getState: vi.fn() }));
vi.mock("@/lib/auth/better-auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("@/lib/auth/server", () => ({ getUser: mocks.getUser }));
vi.mock("@/fn/invitation-bootstrap", () => ({ getInvitationBootstrapState: mocks.getState }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("@/components/organizations/accept-invitation", () => ({ AcceptInvitation: () => <button>Accept invitation</button> }));
vi.mock("@/components/organizations/invitation-bootstrap-form", () => ({ InvitationBootstrapForm: ({ invitationId }: { invitationId: string }) => <form data-invitation-id={invitationId}>Create account and join</form> }));

import proxy from "@/proxy";
import AcceptInvitationPage from "./page";

const INVITATION_ID = "audit-invitation";
const INVITATION_PATH = `/accept-invitation/${INVITATION_ID}`;
const EMAIL = "invitee@e2e.local";
const state = { invitationId: INVITATION_ID, organizationId: "org-audit", email: EMAIL, accountExists: false };
async function visitInvitation() {
  const response = await proxy(new NextRequest(`http://localhost:3100${INVITATION_PATH}`));
  expect(response.status).toBe(200);
  expect(response.headers.get("location")).toBeNull();
  return AcceptInvitationPage({ params: Promise.resolve({ id: INVITATION_ID }) });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue(null);
  mocks.getUser.mockResolvedValue(null);
  mocks.getState.mockResolvedValue({ success: true, data: state });
});

describe("invitation proxy and landing page", () => {
  it("admits a signed-out new invitee to account setup", async () => {
    const html = renderToStaticMarkup(await visitInvitation());
    expect(html).toContain("Create account and join");
    expect(html).toContain(`data-invitation-id="${INVITATION_ID}"`);
    expect(mocks.getState).toHaveBeenCalledWith({ invitationId: INVITATION_ID });
  });
  it("admits an existing invitee and sends them to sign-in with a return path", async () => {
    mocks.getState.mockResolvedValue({ success: true, data: { ...state, accountExists: true } });
    await expect(visitInvitation()).rejects.toThrow(`redirect:/login?from=${encodeURIComponent(INVITATION_PATH)}`);
  });
  it("lets the page refuse an expired invitation without rendering either form", async () => {
    mocks.getState.mockResolvedValue({ success: false, error: "This invitation is invalid, expired, or already used. Ask an Admin for a new invitation." });
    const html = renderToStaticMarkup(await visitInvitation());
    expect(html).toContain("expired");
    expect(html).not.toContain("Create account and join");
    expect(html).not.toContain("Accept invitation</button>");
    expect(mocks.getUser).not.toHaveBeenCalled();
  });
  it("refuses a signed-in user whose email does not own the invitation", async () => {
    const user = { id: "wrong-user", email: "wrong@e2e.local", emailVerified: true };
    mocks.getSession.mockResolvedValue({ user });
    mocks.getUser.mockResolvedValue(user);
    mocks.getState.mockResolvedValue({ success: true, data: { ...state, accountExists: true } });
    const html = renderToStaticMarkup(await visitInvitation());
    expect(html).toContain("Sign out, then sign in with the invited email address.");
    expect(html).not.toContain("Create account and join");
    expect(html).not.toContain("Accept invitation</button>");
  });
  it("allows the matching signed-in user to accept", async () => {
    const user = { id: "invited-user", email: EMAIL.toUpperCase(), emailVerified: true };
    mocks.getSession.mockResolvedValue({ user });
    mocks.getUser.mockResolvedValue(user);
    mocks.getState.mockResolvedValue({ success: true, data: { ...state, accountExists: true } });
    expect(renderToStaticMarkup(await visitInvitation())).toContain("Accept invitation</button>");
  });
  it.each(["/dashboard", "/settings/organization", "/accept-invitation-other/token"])("keeps %s protected", async (path) => {
    const response = await proxy(new NextRequest(`http://localhost:3100${path}`));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`http://localhost:3100/login?from=${encodeURIComponent(path)}`);
  });
  it("keeps unverified users out of the workspace", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "user", emailVerified: false } });
    const response = await proxy(new NextRequest("http://localhost:3100/dashboard"));
    expect(response.headers.get("location")).toBe("http://localhost:3100/verify-email");
  });
});
