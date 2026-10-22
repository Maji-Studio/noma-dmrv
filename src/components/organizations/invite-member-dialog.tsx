/**
 * InviteMemberDialog: the Admin-only invite form, opened from the Members pane.
 * Same fields, schema and action as the inline form it replaced. On success it
 * closes and hands the accept link and the delivery result back to the pane,
 * which shows them until the next invitation.
 */
"use client";

import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { inviteMemberSchema, type InviteMemberInput } from "@/schemas/organizations";
import { FormActions, FormField, FormInput, FormSelect } from "@/components/forms";
import { useSaveRefusal } from "@/components/forms/use-save-refusal";
import { FormDialog } from "@/components/ui/form-dialog";
import { useToast } from "@/components/ui/toast";
import { useInviteMember } from "@/hooks/use-organizations";
import { useLatchedSubmit } from "@/hooks/use-latched-submit";
import type { InvitationDelivery } from "./invitation-link-notice";
import { ORG_ROLE_OPTIONS } from "./organization-roles";

type InviteForm = InviteMemberInput;

const EMPTY_INVITE: InviteForm = { email: "", role: "member" };

export function InviteMemberDialog({
  isOpen,
  onClose,
  onInvited,
}: {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the accept link and whether the email went out, after the invitation is saved. */
  onInvited: (invitation: InvitationDelivery) => void;
}) {
  const titleId = useId();
  const formId = useId();
  const [serverError, setServerError] = useState("");
  const toast = useToast();
  const inviteMember = useInviteMember();
  const latched = useLatchedSubmit();

  const {
    control,
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<InviteForm>({
    resolver: zodResolver(inviteMemberSchema),
    defaultValues: EMPTY_INVITE,
  });

  const refuseSave = useSaveRefusal({ control, setError, formId });

  async function onInvite(values: InviteForm) {
    setServerError("");
    try {
      const result = await inviteMember.mutateAsync(values);
      onInvited({ email: values.email, acceptUrl: result.acceptUrl, emailSent: result.emailSent });
      reset(EMPTY_INVITE);
      // A not-sent invitation is reported by the warning notice; a second green toast would contradict it.
      if (result.emailSent) toast.success("Invitation created.");
      onClose();
    } catch (error) {
      setServerError(
        refuseSave(
          error,
          error instanceof Error
            ? error.message
            : "The invitation was not created. Check the email and try again.",
        ) ?? "",
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
        id={formId}
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
            options={ORG_ROLE_OPTIONS}
            {...register("role")}
          />
        </FormField>
        <FormActions
          control={control}
          isSubmitting={inviteMember.isPending}
          errorMessage={serverError}
          submitLabel="Send invitation"
          submittingLabel="Sending…"
          onCancel={onClose}
          guardDialogCancel
          sticky={false}
        />
      </form>
    </FormDialog>
  );
}
