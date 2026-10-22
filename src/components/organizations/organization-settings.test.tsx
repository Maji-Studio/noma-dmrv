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
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("@/hooks/use-organizations", () => ({
  useOrgMembers: () => ({ data: state.members, isLoading: false }),
  useOrgInvitations: () => ({ data: [], isLoading: false }),
  useInviteMember: () => state.invite,
  useChangeMemberRole: () => state.idle,
  useRemoveMember: () => state.idle,
  useRevokeInvitation: () => state.idle,
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => toast }));

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
  state.invite.mutateAsync.mockResolvedValue({ acceptUrl: "https://app.test/accept-invitation/t" });
});
afterEach(cleanup);

describe("OrganizationSettings invite dialog", () => {
  it("shows the button in the Current members row for Admins, with no inline form", () => {
    render(<OrganizationSettings canManage />);

    expect(openButton()).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Invite a member" })).toBeNull();
    expect(screen.queryByLabelText(/Email/)).toBeNull();
    const row = screen.getByRole("heading", { name: "Current members" }).parentElement!;
    expect(row.contains(openButton())).toBe(true);
  });

  it("shows no button to members and viewers", () => {
    render(<OrganizationSettings canManage={false} />);
    expect(openButton()).toBeNull();
  });

  it("offers the same dialog from the empty state", () => {
    state.members = [];
    render(<OrganizationSettings canManage />);

    expect(screen.getByText("No members yet")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Invite member" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Invite your first member" })).toBeTruthy();
  });

  it("opens the dialog with the email and role fields", async () => {
    render(<OrganizationSettings canManage />);
    fireEvent.click(openButton()!);

    await screen.findByRole("dialog", { name: "Invite a member" });
    expect(screen.getByLabelText(/Email/)).toBeTruthy();
    expect((within(screen.getByRole("dialog")).getByLabelText(/Role/) as HTMLSelectElement).value).toBe("member");
  });

  it("validates the email before calling the action", async () => {
    render(<OrganizationSettings canManage />);
    await fillAndSend("a@b");

    expect(await screen.findByText("Enter a valid email address.")).toBeTruthy();
    expect(state.invite.mutateAsync).not.toHaveBeenCalled();
  });

  it("sends the invitation, closes, and shows the accept link", async () => {
    render(<OrganizationSettings canManage />);
    await fillAndSend("new@example.com");

    await waitFor(() =>
      expect(state.invite.mutateAsync).toHaveBeenCalledWith({ email: "new@example.com", role: "member" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(toast.success).toHaveBeenCalledWith("Invitation created.");
    expect((screen.getByRole("textbox", { name: "Invitation link" }) as HTMLInputElement).value).toBe(
      "https://app.test/accept-invitation/t",
    );
  });

  it("asks before Cancel discards a draft, and a discard starts the next draft empty", async () => {
    render(<OrganizationSettings canManage />);
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
    render(<OrganizationSettings canManage />);
    await fillAndSend("dev@example.com");

    expect(await screen.findByText("That person is already a member.")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Invite a member" })).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Invitation link" })).toBeNull();
  });
});
