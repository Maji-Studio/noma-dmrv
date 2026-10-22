/**
 * OrganizationSettings — member-management surface for org Admins
 * (and Platform Admins). Invite by email (in a dialog), manage roles, remove members, and
 * revoke pending invitations. Read-only members see the roster without controls.
 *
 * After an invite is created the pane says whether the email went out and keeps
 * the accept link copyable.
 */
"use client";

import { useState } from "react";
import { format } from "date-fns/format";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { FormSelect } from "@/components/forms/form-select";
import { useToast } from "@/components/ui/toast";
import { InvitationLinkNotice, type InvitationDelivery } from "./invitation-link-notice";
import {
  useChangeMemberRole,
  useLeaveOrganization,
  useOrgInvitations,
  useOrgMembers,
  useResendInvitation,
  useResetAfterOrgSwitch,
  useRevokeInvitation,
  useRemoveMember,
} from "@/hooks/use-organizations";
import {
  OrganizationRosterList,
  OrganizationRosterRow,
} from "./organization-roster-list";
import { Notice } from "@/components/ui/notice";
import { InviteMemberDialog } from "./invite-member-dialog";
import { ORG_ROLE_OPTIONS as ROLE_OPTIONS } from "./organization-roles";
import { ILLUSTRATION_SIZE, EnvelopeArt, MembersArt } from "@/components/ui/illustrations";

const ROLE_LABELS: Record<string, string> = Object.fromEntries(
  ROLE_OPTIONS.map((option) => [option.value, option.label]),
);

const EXPIRY_DATE_FORMAT = "MMM d";
/** After leaving, the hard load lands here: no organization is active any more. */
const AFTER_LEAVE_HREF = "/";

interface OrganizationSettingsProps {
  canManage: boolean;
  /** The organization being worked in; names the Leave control. */
  organizationName: string;
  /** True only for a member of this organization, never a Platform Admin without a membership. */
  canLeave: boolean;
}

/** "Expires Oct 29" before the day, "Expired Oct 20" after it. */
function expiryText(expiresAt: Date | string | null, expired: boolean): string | null {
  if (!expiresAt) return null;
  return `${expired ? "Expired" : "Expires"} ${format(new Date(expiresAt), EXPIRY_DATE_FORMAT)}`;
}

export function OrganizationSettings({ canManage, organizationName, canLeave }: OrganizationSettingsProps) {
  const toast = useToast();
  const { data: members, isLoading: membersLoading } = useOrgMembers();
  const { data: invitations, isLoading: invitationsLoading } =
    useOrgInvitations(canManage);

  const changeRole = useChangeMemberRole();
  const removeMember = useRemoveMember();
  const revokeInvitation = useRevokeInvitation();
  const resendInvitation = useResendInvitation();
  const leaveOrganization = useLeaveOrganization();
  const resetAfterOrgSwitch = useResetAfterOrgSwitch();

  const [lastInvitation, setLastInvitation] = useState<InvitationDelivery | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removingMember, setRemovingMember] = useState<{
    memberId: string;
    email: string;
  } | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveError, setLeaveError] = useState<string | undefined>();
  const [revokingInvite, setRevokingInvite] = useState<{
    id: string;
    email: string;
  } | null>(null);

  async function onChangeRole(memberId: string, role: string) {
    try {
      await changeRole.mutateAsync({ memberId, role });
      toast.success("Role updated.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "The member role was not changed. Try again."
      );
    }
  }

  async function confirmRemoveMember() {
    if (!removingMember) return;
    try {
      await removeMember.mutateAsync(removingMember.memberId);
      toast.success("Member removed.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "The member was not removed. Try again."
      );
    } finally {
      setRemovingMember(null);
    }
  }

  async function sendAgain(invite: { id: string; email: string }) {
    setResendingId(invite.id);
    try {
      const result = await resendInvitation.mutateAsync(invite.id);
      setLastInvitation({ email: invite.email, acceptUrl: result.acceptUrl, emailSent: result.emailSent });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "The invitation was not sent again. Try again."
      );
    } finally {
      setResendingId(null);
    }
  }

  async function confirmLeave() {
    setLeaveError(undefined);
    try {
      await leaveOrganization.mutateAsync();
    } catch (error) {
      setLeaveError(
        error instanceof Error ? error.message : "You were not removed from the organization. Try again."
      );
      return;
    }
    // The dialog stays busy until the hard load replaces the page.
    resetAfterOrgSwitch(undefined, undefined, AFTER_LEAVE_HREF);
  }

  function closeLeave() {
    setLeaveOpen(false);
    setLeaveError(undefined);
  }

  async function confirmRevoke() {
    if (!revokingInvite) return;
    try {
      await revokeInvitation.mutateAsync(revokingInvite.id);
      toast.success("Invitation revoked.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "The invitation was not revoked. Try again."
      );
    } finally {
      setRevokingInvite(null);
    }
  }

  const inviteButton = canManage ? (
    <Button
      type="button"
      size="small"
      className="shrink-0 max-sm:h-44"
      onClick={() => setInviteOpen(true)}
    >
      Invite member
    </Button>
  ) : null;

  return (
    <div className="flex flex-col gap-32">
      {canManage && lastInvitation && <InvitationLinkNotice key={lastInvitation.acceptUrl} invitation={lastInvitation} />}

      {/* The roster. Named "Current members" rather than "Members" because the
          pane it sits in is already titled Members. The invite button sits in
          its heading row and opens the invite dialog. */}
      <section className="flex flex-col gap-16">
        <div className="flex items-start justify-between gap-12">
          <h2 className="title-heading-3 min-w-0 flex-1">Current members</h2>
          {inviteButton}
        </div>
        {membersLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : !members || members.length === 0 ? (
          <EmptyState
            icon={<MembersArt size={ILLUSTRATION_SIZE.empty} />}
            title="No members yet"
            description="Invite teammates to give them access to this organization."
            padding="md"
            action={
              canManage ? (
                <Button type="button" size="small" onClick={() => setInviteOpen(true)}>
                  Invite your first member
                </Button>
              ) : undefined
            }
          />
        ) : (
          <OrganizationRosterList>
            {members.map((member) => (
              <OrganizationRosterRow
                key={member.memberId}
                primary={member.name?.trim() || member.email}
                secondary={member.email}
                actions={
                  <>
                    {canManage ? (
                      <FormSelect
                        options={ROLE_OPTIONS}
                        value={member.role}
                        onChange={(e) =>
                          onChangeRole(member.memberId, e.target.value)
                        }
                        className="w-[140px]"
                        aria-label={`Role for ${member.email}`}
                      />
                    ) : (
                      <span className="body-caption text-[var(--color-text-secondary)]">
                        {ROLE_LABELS[member.role] ?? member.role}
                      </span>
                    )}
                    {canManage && (
                      <Button
                        type="button"
                        variant="destructive"
                        size="small"
                        onClick={() =>
                          setRemovingMember({
                            memberId: member.memberId,
                            email: member.email,
                          })
                        }
                      >
                        Remove
                      </Button>
                    )}
                  </>
                }
              />
            ))}
          </OrganizationRosterList>
        )}
      </section>

      {/* Pending invitations */}
      {canManage && (
        <section className="flex flex-col gap-16">
          <h2 className="title-heading-3">Pending invitations</h2>
          {invitationsLoading ? (
            <div aria-busy="true">
              <Skeleton className="h-64 w-full" />
            </div>
          ) : !invitations || invitations.length === 0 ? (
            <EmptyState
              icon={<EnvelopeArt size={ILLUSTRATION_SIZE.empty} />}
              title="No pending invitations"
              description="Invitations you send appear here until they're accepted."
              padding="md"
            />
          ) : (
            <OrganizationRosterList>
              {invitations.map((invite) => (
                <OrganizationRosterRow
                  key={invite.id}
                  primary={
                    <span className="flex min-w-0 items-center gap-8">
                      <span className="truncate">{invite.email}</span>
                      {invite.expired && <StatusBadge status="expired" size="small" />}
                    </span>
                  }
                  secondary={[ROLE_LABELS[invite.role] ?? invite.role, expiryText(invite.expiresAt, invite.expired)]
                    .filter(Boolean)
                    .join(" \u00b7 ")}
                  actions={
                    <>
                      <Button
                        type="button"
                        variant="weak"
                        size="small"
                        busy={resendingId === invite.id}
                        onClick={() => sendAgain({ id: invite.id, email: invite.email })}
                      >
                        Send again
                      </Button>
                      <Button
                        type="button"
                        variant="weak"
                        size="small"
                        onClick={() =>
                          setRevokingInvite({ id: invite.id, email: invite.email })
                        }
                      >
                        Revoke
                      </Button>
                    </>
                  }
                />
              ))}
            </OrganizationRosterList>
          )}
        </section>
      )}

      {canLeave && (
        <section className="flex flex-col gap-12 border-t border-[var(--color-border-tertiary)] pt-24">
          <h2 className="title-heading-3">Leave {organizationName}</h2>
          <div>
            <Button type="button" variant="destructive" size="small" className="max-sm:h-44" onClick={() => setLeaveOpen(true)}>
              Leave organization
            </Button>
          </div>
        </section>
      )}

      {canManage && inviteOpen && (
        // Mounted only while open, so a discarded draft never comes back.
        <InviteMemberDialog
          isOpen
          onClose={() => setInviteOpen(false)}
          onInvited={setLastInvitation}
        />
      )}
      <DeleteConfirmDialog
        isOpen={Boolean(removingMember)}
        title="Remove member"
        message={`Remove ${removingMember?.email ?? "this member"} from the organization? They'll lose access immediately.`}
        onConfirm={confirmRemoveMember}
        onCancel={() => setRemovingMember(null)}
        isPending={removeMember.isPending}
      />
      <DeleteConfirmDialog
        isOpen={leaveOpen}
        title={`Leave ${organizationName}?`}
        message="You lose access to its data straight away."
        confirmLabel="Leave organization"
        errorMessage={leaveError}
        onConfirm={confirmLeave}
        onCancel={closeLeave}
        isPending={leaveOrganization.isPending}
      />
      <DeleteConfirmDialog
        isOpen={Boolean(revokingInvite)}
        title="Revoke invitation"
        message={`Revoke the invitation for ${revokingInvite?.email ?? "this email"}? The link will stop working.`}
        onConfirm={confirmRevoke}
        onCancel={() => setRevokingInvite(null)}
        isPending={revokeInvitation.isPending}
      />
    </div>
  );
}
