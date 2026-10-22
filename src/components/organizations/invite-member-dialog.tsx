/**
 * InviteMemberDialog: the Admin-only invite form, opened from the Members pane.
 * Same fields, schema and action as the inline form it replaced. On success it
 * closes and hands the accept link back to the pane, which shows it until the
 * next invitation (email delivery is best-effort, the link is the reliable path).
 */
"use client";

import { useId } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { inviteMemberSchema } from "@/schemas/organizations";
import { FormActions, FormField, FormInput, FormSelect } from "@/components/forms";
import { FormDialog } from "@/components/ui/form-dialog";
import { useToast } from "@/components/ui/toast";
import { useInviteMember } from "@/hooks/use-organizations";
import { useLatchedSubmit } from "@/hooks/use-latched-submit";

export const INVITE_ROLE_OPTIONS = [
  { value: "admin", label: "Admin" },
  { value: "member", label: "Member" },
] as const;

type InviteForm = z.infer<typeof inviteMemberSchema>;

const EMPTY_INVITE: InviteForm = { email: "", role: "member" };

export function InviteMemberDialog({
  isOpen,
  onClose,
  onInvited,
}: {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the accept link after the invitation is created. */
  onInvited: (acceptUrl: string) => void;
}) {
  const titleId = useId();
  const toast = useToast();
  const inviteMember = useInviteMember();
  const latched = useLatchedSubmit();

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<InviteForm>({
    resolver: zodResolver(inviteMemberSchema),
    defaultValues: EMPTY_INVITE,
  });

  async function onInvite(values: InviteForm) {
    try {
      const result = await inviteMember.mutateAsync(values);
      onInvited(result.acceptUrl);
      reset(EMPTY_INVITE);
      toast.success("Invitation created.");
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "The invitation was not created. Check the email and try again.",
      );
    }
  }

  return (
    <FormDialog
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy={titleId}
      width="md"
    >
      <form
        onSubmit={latched(handleSubmit(onInvite))}
        className="flex flex-col gap-16"
      >
        <h2 id={titleId} className="title-heading-3">
          Invite a member
        </h2>
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
            options={INVITE_ROLE_OPTIONS}
            {...register("role")}
          />
        </FormField>
        <FormActions
          control={control}
          isSubmitting={inviteMember.isPending}
          submitLabel="Send invitation"
          submittingLabel="Sending…"
          onCancel={onClose}
          sticky={false}
        />
      </form>
    </FormDialog>
  );
}
