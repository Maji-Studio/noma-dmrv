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
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { FormSelect } from "@/components/forms/form-select";
import { PHONE_TOUCH_TARGET } from "@/components/ui/touch-target";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { InvitationLinkNotice, type InvitationDelivery } from "./invitation-link-notice";
import {
  useChangeMemberRole,
  useOrgInvitations,
  useOrgMembers,
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

export function OrganizationSettings({ canManage }: { canManage: boolean }) {
  const toast = useToast();
  const { data: members, isLoading: membersLoading } = useOrgMembers();
  const { data: invitations, isLoading: invitationsLoading } =
    useOrgInvitations(canManage);

  const changeRole = useChangeMemberRole();
  const removeMember = useRemoveMember();
  const revokeInvitation = useRevokeInvitation();

  const [lastInvitation, setLastInvitation] = useState<InvitationDelivery | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removingMember, setRemovingMember] = useState<{
    memberId: string;
    email: string;
  } | null>(null);
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
                        className={cn("w-[140px]", PHONE_TOUCH_TARGET)}
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
                  primary={invite.email}
                  secondary={ROLE_LABELS[invite.role] ?? invite.role}
                  actions={
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
                  }
                />
              ))}
            </OrganizationRosterList>
          )}
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
