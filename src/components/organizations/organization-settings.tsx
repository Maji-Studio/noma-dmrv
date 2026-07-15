/**
 * OrganizationSettings — member-management surface for org Owners/Admins
 * (and Platform Admins). Invite by email, manage roles, remove members, and
 * revoke pending invitations. Read-only members see the roster without controls.
 *
 * Invitation delivery is best-effort email; the reliable path is the copyable
 * accept link surfaced here after an invite is created.
 */
"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { inviteMemberSchema } from "@/schemas/organizations";
import {
  CheckCircleIcon,
  CopyIcon,
  EnvelopeSimpleIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import {
  FormActions,
  FormField,
  FormInput,
  FormSelect,
} from "@/components/forms";
import { useToast } from "@/components/ui/toast";
import {
  useChangeMemberRole,
  useInviteMember,
  useOrgInvitations,
  useOrgMembers,
  useRevokeInvitation,
  useRemoveMember,
} from "@/hooks/use-organizations";
import {
  OrganizationRosterList,
  OrganizationRosterRow,
} from "./organization-roster-list";

const ROLE_OPTIONS = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "member", label: "Member" },
] as const;

type InviteForm = z.infer<typeof inviteMemberSchema>;

export function OrganizationSettings({ canManage }: { canManage: boolean }) {
  const toast = useToast();
  const { data: members, isLoading: membersLoading } = useOrgMembers();
  const { data: invitations } = useOrgInvitations(canManage);

  const inviteMember = useInviteMember();
  const changeRole = useChangeMemberRole();
  const removeMember = useRemoveMember();
  const revokeInvitation = useRevokeInvitation();

  const [lastInviteLink, setLastInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [removingMember, setRemovingMember] = useState<{
    memberId: string;
    email: string;
  } | null>(null);
  const [revokingInvite, setRevokingInvite] = useState<{
    id: string;
    email: string;
  } | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<InviteForm>({
    resolver: zodResolver(inviteMemberSchema),
    defaultValues: { role: "member" },
  });

  async function onInvite(values: InviteForm) {
    try {
      const result = await inviteMember.mutateAsync(values);
      setLastInviteLink(result.acceptUrl);
      setCopied(false);
      reset({ email: "", role: "member" });
      toast.success("Invitation created.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to invite.");
    }
  }

  async function copyLink() {
    if (!lastInviteLink) return;
    try {
      await navigator.clipboard.writeText(lastInviteLink);
      setCopied(true);
      toast.success("Invitation link copied.");
    } catch {
      toast.error("Could not copy — select and copy the link manually.");
    }
  }

  async function onChangeRole(memberId: string, role: string) {
    try {
      await changeRole.mutateAsync({ memberId, role });
      toast.success("Role updated.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to change role."
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
        error instanceof Error ? error.message : "Failed to remove member."
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
        error instanceof Error ? error.message : "Failed to revoke."
      );
    } finally {
      setRevokingInvite(null);
    }
  }

  return (
    <div className="flex flex-col gap-32">
      {/* Invite */}
      {canManage && (
        <section className="flex flex-col gap-16">
          <h2 className="title-heading-3">Invite a member</h2>
          <form
            onSubmit={handleSubmit(onInvite)}
            className="flex flex-col gap-16 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-20"
          >
            <div className="grid grid-cols-1 gap-16 md:grid-cols-[1fr_180px]">
              <FormField
                id="invite-email"
                label="Email"
                error={errors.email?.message}
                required
              >
                <FormInput
                  id="invite-email"
                  type="email"
                  placeholder="teammate@example.com"
                  autoComplete="off"
                  {...register("email")}
                />
              </FormField>
              <FormField
                id="invite-role"
                label="Role"
                error={errors.role?.message}
                required
              >
                <FormSelect
                  id="invite-role"
                  options={ROLE_OPTIONS}
                  {...register("role")}
                />
              </FormField>
            </div>
            {lastInviteLink && (
              <div className="flex flex-col gap-8 border border-[var(--st-ok-border)] bg-[var(--st-ok-bg)] p-12">
                <span className="body-caption font-medium text-[var(--color-text-primary)]">
                  Share this link with the invitee
                </span>
                <div className="flex items-center gap-8">
                  <input
                    readOnly
                    value={lastInviteLink}
                    onFocus={(e) => e.currentTarget.select()}
                    className="min-w-0 flex-1 border border-[var(--color-border-tertiary)] bg-[var(--color-background-medium)] px-8 py-6 body-caption font-mono"
                  />
                  <Button
                    type="button"
                    variant="weak"
                    size="small"
                    onClick={copyLink}
                  >
                    {copied ? (
                      <CheckCircleIcon size={16} weight="fill" />
                    ) : (
                      <CopyIcon size={16} />
                    )}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>
            )}
            <FormActions
              isSubmitting={inviteMember.isPending}
              submitLabel="Send invitation"
              submittingLabel="Sending…"
              sticky={false}
            />
          </form>
        </section>
      )}

      {/* Members */}
      <section className="flex flex-col gap-16">
        <h2 className="title-heading-3">Members</h2>
        {membersLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : !members || members.length === 0 ? (
          <EmptyState
            icon={<UsersIcon size={40} />}
            title="No members yet"
            description="Invite teammates to give them access to this organization."
            padding="md"
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
                      <span className="body-caption uppercase tracking-wide text-[var(--color-text-secondary)]">
                        {member.role}
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
          {!invitations || invitations.length === 0 ? (
            <EmptyState
              icon={<EnvelopeSimpleIcon size={40} />}
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
                  secondary={invite.role}
                  secondaryClassName="uppercase tracking-wide"
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
