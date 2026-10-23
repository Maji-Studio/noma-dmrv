// @vitest-environment jsdom
/**
 * Members pane: the invite form lives in a dialog opened from the "Current
 * members" heading row (#1277). Admins only; the action and schema are unchanged.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationSettings } from "./organization-settings";

const state = vi.hoisted(() => ({
  members: [] as { memberId: string; name: string | null; email: string; role: string }[],
  invite: { mutateAsync: vi.fn(), isPending: false },
  idle: { mutateAsync: vi.fn(), isPending: false },
  invitations: [] as { id: string; email: string; role: string; expiresAt: Date; expired: boolean }[],
  resend: { mutateAsync: vi.fn(), isPending: false },
  leave: { mutateAsync: vi.fn(), isPending: false },
  resetAfterOrgSwitch: vi.fn(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("@/hooks/use-organizations", () => ({
  useOrgMembers: () => ({ data: state.members, isLoading: false }),
  useOrgInvitations: () => ({ data: state.invitations, isLoading: false }),
  useResendInvitation: () => state.resend,
  useLeaveOrganization: () => state.leave,
  useResetAfterOrgSwitch: () => state.resetAfterOrgSwitch,
  useInviteMember: () => state.invite,
  useChangeMemberRole: () => state.idle,
  useRemoveMember: () => state.idle,
  useRevokeInvitation: () => state.idle,
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => toast }));

const PROPS = { organizationName: "Dark Earth Carbon", canLeave: false };
const MEMBER = { memberId: "m1", name: "Dev Teammate", email: "dev@example.com", role: "admin" };
const openButton = () => screen.queryByRole("button", { name: "Invite member" });

async function fillAndSend(email: string) {
  fireEvent.click(openButton()!);
  const dialog = await screen.findByRole("dialog", { name: "Invite a member" });
  fireEvent.change(screen.getByLabelText(/Email/), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
  return dialog;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.members = [MEMBER];
  state.invitations = [];
  state.invite.mutateAsync.mockResolvedValue({ acceptUrl: "https://app.test/accept-invitation/t", emailSent: true });
});
afterEach(cleanup);

describe("OrganizationSettings invite dialog", () => {
  it("shows the button in the Current members row for Admins, with no inline form", () => {
    render(<OrganizationSettings {...PROPS} canManage />);

    expect(openButton()).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Invite a member" })).toBeNull();
    expect(screen.queryByLabelText(/Email/)).toBeNull();
    const row = screen.getByRole("heading", { name: "Current members" }).parentElement!;
    expect(row.contains(openButton())).toBe(true);
  });

  it("shows no button to members and viewers", () => {
    render(<OrganizationSettings {...PROPS} canManage={false} />);
    expect(openButton()).toBeNull();
  });

  it("offers the same dialog from the empty state", () => {
    state.members = [];
    render(<OrganizationSettings {...PROPS} canManage />);

    expect(screen.getByText("No members yet")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Invite member" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Invite your first member" })).toBeTruthy();
  });

  it("opens the dialog with the email and role fields", async () => {
    render(<OrganizationSettings {...PROPS} canManage />);
    fireEvent.click(openButton()!);

    await screen.findByRole("dialog", { name: "Invite a member" });
    expect(screen.getByLabelText(/Email/)).toBeTruthy();
    expect((within(screen.getByRole("dialog")).getByLabelText(/Role/) as HTMLSelectElement).value).toBe("member");
  });

  it("validates the email before calling the action", async () => {
    render(<OrganizationSettings {...PROPS} canManage />);
    await fillAndSend("a@b");

    expect(await screen.findByText("Enter a valid email address.")).toBeTruthy();
    expect(state.invite.mutateAsync).not.toHaveBeenCalled();
  });

  it("sends the invitation, closes, and shows the accept link", async () => {
    render(<OrganizationSettings {...PROPS} canManage />);
    await fillAndSend("new@example.com");

    await waitFor(() =>
      expect(state.invite.mutateAsync).toHaveBeenCalledWith({ email: "new@example.com", role: "member" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(toast.success).not.toHaveBeenCalled();
    expect((screen.getByRole("textbox", { name: "Invitation link" }) as HTMLInputElement).value).toBe(
      "https://app.test/accept-invitation/t",
    );
  });

  it("says the invitation was emailed when the email went out", async () => {
    render(<OrganizationSettings {...PROPS} canManage />);
    await fillAndSend("new@example.com");

    expect(await screen.findByText("Invitation emailed to new@example.com")).toBeTruthy();
    expect(screen.queryByText(/did not send/)).toBeNull();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
  });

  it("keeps the invitation and says the email did not send, with the link to copy", async () => {
    state.invite.mutateAsync.mockResolvedValue({ acceptUrl: "https://app.test/accept-invitation/t", emailSent: false });
    render(<OrganizationSettings {...PROPS} canManage />);
    await fillAndSend("new@example.com");

    expect(await screen.findByText("The email to new@example.com did not send")).toBeTruthy();
    expect(
      screen.getByText("The invitation is saved. Copy the link and send it another way, or check the address."),
    ).toBeTruthy();
    expect(screen.queryByText(/Invitation emailed/)).toBeNull();
    expect(toast.success).not.toHaveBeenCalled();
    expect((screen.getByRole("textbox", { name: "Invitation link" }) as HTMLInputElement).value).toBe(
      "https://app.test/accept-invitation/t",
    );
    expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
  });

  it("asks before Cancel discards a draft, and a discard starts the next draft empty", async () => {
    render(<OrganizationSettings {...PROPS} canManage />);
    fireEvent.click(openButton()!);
    await screen.findByRole("dialog", { name: "Invite a member" });
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: "draft@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.click(await screen.findByRole("button", { name: /Discard/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(openButton()!);
    await screen.findByRole("dialog", { name: "Invite a member" });
    expect((screen.getByLabelText(/Email/) as HTMLInputElement).value).toBe("");
  });

  it("keeps the dialog open and shows the error when the invitation fails", async () => {
    state.invite.mutateAsync.mockRejectedValue(new Error("That person is already a member."));
    render(<OrganizationSettings {...PROPS} canManage />);
    await fillAndSend("dev@example.com");

    expect(await screen.findByText("That person is already a member.")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Invite a member" })).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Invitation link" })).toBeNull();
  });
});

const PENDING = { id: "i1", email: "pending@example.com", role: "member", expiresAt: new Date("2026-10-29T12:00:00"), expired: false };
const EXPIRED = { id: "i2", email: "expired@example.com", role: "admin", expiresAt: new Date("2026-10-20T12:00:00"), expired: true };
const rowOf = (email: string) => screen.getByText(email).closest("li")!;

describe("OrganizationSettings pending and expired invitations", () => {
  beforeEach(() => {
    state.invitations = [PENDING, EXPIRED];
  });

  it("marks an expired invitation and says when each one expires", () => {
    render(<OrganizationSettings {...PROPS} canManage />);

    expect(within(rowOf("pending@example.com")).queryByText(/Expired/)).toBeNull();
    expect(within(rowOf("pending@example.com")).getByText(/Expires Oct 29, 2026/)).toBeTruthy();
    // Said once: the badge carries the date, the meta line keeps the role.
    expect(within(rowOf("expired@example.com")).getAllByText(/Expired/)).toHaveLength(1);
    expect(within(rowOf("expired@example.com")).getByText("Expired Oct 20, 2026")).toBeTruthy();
    expect(within(rowOf("expired@example.com")).queryByText(/Expires/)).toBeNull();
  });

  it("offers Send again on pending and expired rows", () => {
    render(<OrganizationSettings {...PROPS} canManage />);

    for (const email of ["pending@example.com", "expired@example.com"]) {
      expect(within(rowOf(email)).getByRole("button", { name: "Send again" })).toBeTruthy();
    }
  });

  it("shows the emailed notice after Send again", async () => {
    state.resend.mutateAsync.mockResolvedValue({ invitationId: "n", acceptUrl: "https://app.test/accept-invitation/n", emailSent: true });
    render(<OrganizationSettings {...PROPS} canManage />);
    fireEvent.click(within(rowOf("expired@example.com")).getByRole("button", { name: "Send again" }));

    expect(await screen.findByText("Invitation emailed to expired@example.com")).toBeTruthy();
    expect(state.resend.mutateAsync).toHaveBeenCalledWith("i2");
    expect((screen.getByRole("textbox", { name: "Invitation link" }) as HTMLInputElement).value).toBe(
      "https://app.test/accept-invitation/n",
    );
  });

  it("moves focus to the delivery notice after Send again", async () => {
    state.resend.mutateAsync.mockResolvedValue({ invitationId: "n", acceptUrl: "https://app.test/accept-invitation/n", emailSent: true });
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<OrganizationSettings {...PROPS} canManage />);
    fireEvent.click(within(rowOf("expired@example.com")).getByRole("button", { name: "Send again" }));

    const title = await screen.findByText("Invitation emailed to expired@example.com");
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(title.closest("[tabindex='-1']"));
  });

  it("says the email did not send after Send again, keeping the link", async () => {
    state.resend.mutateAsync.mockResolvedValue({ invitationId: "n", acceptUrl: "https://app.test/accept-invitation/n", emailSent: false });
    render(<OrganizationSettings {...PROPS} canManage />);
    fireEvent.click(within(rowOf("pending@example.com")).getByRole("button", { name: "Send again" }));

    expect(await screen.findByText("The email to pending@example.com did not send")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
  });

  it("toasts the refusal when Send again fails", async () => {
    state.resend.mutateAsync.mockRejectedValue(new Error("Invitation not found or is no longer pending."));
    render(<OrganizationSettings {...PROPS} canManage />);
    fireEvent.click(within(rowOf("pending@example.com")).getByRole("button", { name: "Send again" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Invitation not found or is no longer pending."));
    expect(screen.queryByRole("textbox", { name: "Invitation link" })).toBeNull();
  });
});

describe("OrganizationSettings leave organization", () => {
  const leaveButton = () => screen.queryByRole("button", { name: "Leave Dark Earth Carbon" });
  const openDialog = () => {
    fireEvent.click(leaveButton()!);
    return screen.findByRole("dialog", { name: "Leave Dark Earth Carbon?" });
  };

  it("shows Leave to members of any role and hides it from a Platform Admin without a membership", () => {
    const { rerender } = render(<OrganizationSettings {...PROPS} canManage={false} canLeave />);
    expect(leaveButton()).toBeTruthy();
    rerender(<OrganizationSettings {...PROPS} canManage canLeave={false} />);
    expect(leaveButton()).toBeNull();
  });

  it("confirms, leaves, and hard-navigates out of the organization", async () => {
    state.leave.mutateAsync.mockResolvedValue({ organizationId: null });
    render(<OrganizationSettings {...PROPS} canManage canLeave />);
    const dialog = await openDialog();
    expect(within(dialog).getByText("You lose access to its data straight away.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Leave organization" }));

    await waitFor(() => expect(state.resetAfterOrgSwitch).toHaveBeenCalledWith(undefined, undefined, "/"));
    expect(state.leave.mutateAsync).toHaveBeenCalledOnce();
  });

  it("keeps the confirm button busy after a successful leave until the page unloads", async () => {
    state.leave.mutateAsync.mockResolvedValue({ organizationId: null });
    render(<OrganizationSettings {...PROPS} canManage canLeave />);
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Leave organization" }));

    await waitFor(() => expect(state.resetAfterOrgSwitch).toHaveBeenCalled());
    expect(within(dialog).getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(true);
    expect(within(dialog).getByRole("button", { name: "Leave organization" }).hasAttribute("disabled")).toBe(true);
  });

  it("cancels without leaving", async () => {
    render(<OrganizationSettings {...PROPS} canManage canLeave />);
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(state.leave.mutateAsync).not.toHaveBeenCalled();
    expect(state.resetAfterOrgSwitch).not.toHaveBeenCalled();
  });

  it("shows the last-Admin refusal in the dialog and stays put", async () => {
    const refusal = "An organization must keep at least one Admin. Make another member an Admin first.";
    state.leave.mutateAsync.mockRejectedValue(new Error(refusal));
    render(<OrganizationSettings {...PROPS} canManage canLeave />);
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Leave organization" }));

    // ServerError splits the first sentence into the title.
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(refusal);
    expect(state.resetAfterOrgSwitch).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(false);
  });
});
