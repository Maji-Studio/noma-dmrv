/**
 * Settings, You, Profile (#1277 wave 2, decisions 3 and 4): your name, your
 * email (shown, not editable: a new address comes as a new invitation), and a
 * password change that signs out every other device. Two forms, because a
 * name save must never send a password and a password change must ask for
 * the current one.
 */
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import {
  FormActions,
  FormField,
  FormInput,
  FormSection,
  ResolvedErrorRevalidator,
} from "@/components/forms";
import { useSaveRefusal } from "@/components/forms/use-save-refusal";
import { DetailField } from "@/components/ui/detail-panel";
import { useToast } from "@/components/ui/toast";
import { useLatchedSubmit } from "@/hooks/use-latched-submit";
import { useChangePassword, useUpdateProfileName } from "@/hooks/use-profile";
import { AUTH_PASSWORD_MIN_LENGTH, SESSION_COOKIE_CACHE_SECONDS } from "@/config/auth";
import {
  changePasswordSchema,
  profileNameSchema,
  type ChangePasswordFormData,
  type ProfileNameFormData,
} from "@/schemas/profile";

const EMAIL_NOTE = "To use another email, ask an Admin to invite that address.";
const SIGN_OUT_MINUTES = SESSION_COOKIE_CACHE_SECONDS / 60;
const PASSWORD_NOTE = `Changing it signs you out on every other device within ${SIGN_OUT_MINUTES} minutes. This one stays signed in.`;
const PASSWORD_CHANGED = `Password changed. Other devices are signed out within ${SIGN_OUT_MINUTES} minutes.`;
const EMPTY_PASSWORDS: ChangePasswordFormData = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
};

export function ProfileSettingsPane({ name, email }: { name: string; email: string }) {
  return (
    <div className="content-measure-form flex flex-col gap-32">
      <NameForm name={name} email={email} />
      <PasswordForm />
    </div>
  );
}

function NameForm({ name, email }: { name: string; email: string }) {
  const toast = useToast();
  const latched = useLatchedSubmit();
  const mutation = useUpdateProfileName();
  const [serverError, setServerError] = useState("");
  const {
    control,
    register,
    handleSubmit,
    reset,
    trigger,
    formState: { errors },
  } = useForm<ProfileNameFormData>({
    resolver: zodResolver(profileNameSchema),
    defaultValues: { name },
  });

  const onSubmit = latched(
    handleSubmit(async (values) => {
      setServerError("");
      try {
        const saved = await mutation.mutateAsync(values);
        // The saved name becomes the form's baseline. No page refresh: it
        // would remount the pane and drop a password being typed below.
        reset({ name: saved.name });
        toast.success("Name saved.");
      } catch (error) {
        setServerError(error instanceof Error ? error.message : "Your name was not saved. Try again.");
      }
    }),
  );

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-24">
      <ResolvedErrorRevalidator control={control} trigger={trigger} />
      <FormSection divider={false}>
        <FormField id="profile-name" label="Name" error={errors.name?.message}>
          <FormInput
            id="profile-name"
            type="text"
            autoComplete="name"
            error={!!errors.name}
            {...register("name")}
          />
        </FormField>
        <div className="flex flex-col gap-4">
          <DetailField label="Email" value={email} />
          <p className="body-caption text-[var(--color-text-tertiary)]">{EMAIL_NOTE}</p>
        </div>
      </FormSection>
      <FormActions
        control={control}
        isSubmitting={mutation.isPending}
        errorMessage={serverError}
        submitLabel="Save name"
        sticky={false}
      />
    </form>
  );
}

function PasswordForm() {
  const toast = useToast();
  const latched = useLatchedSubmit();
  const formId = useId();
  const mutation = useChangePassword();
  const [serverError, setServerError] = useState("");
  const {
    control,
    register,
    handleSubmit,
    reset,
    setError,
    trigger,
    formState: { errors },
  } = useForm<ChangePasswordFormData>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: EMPTY_PASSWORDS,
  });
  const refuseSave = useSaveRefusal({ control, setError, formId });

  const onSubmit = latched(
    handleSubmit(async (values) => {
      setServerError("");
      try {
        const { otherDevicesSignedOut } = await mutation.mutateAsync(values);
        reset(EMPTY_PASSWORDS);
        if (otherDevicesSignedOut) toast.success(PASSWORD_CHANGED);
        else toast.warning("Password changed. Other devices are still signed in, so sign out on each of them.");
      } catch (error) {
        setServerError(refuseSave(
          error,
          error instanceof Error ? error.message : "Your password was not changed. Try again.",
        ) ?? "");
      }
    }),
  );

  return (
    <form id={formId} onSubmit={onSubmit} className="flex flex-col gap-24">
      <ResolvedErrorRevalidator control={control} trigger={trigger} />
      <FormSection title="Password">
        <p className="body-small pb-8 text-[var(--color-text-secondary)]">{PASSWORD_NOTE}</p>
        <FormField id="currentPassword" label="Current password" error={errors.currentPassword?.message}>
          <FormInput
            id="currentPassword"
            type="password"
            autoComplete="current-password"
            error={!!errors.currentPassword}
            {...register("currentPassword")}
          />
        </FormField>
        <FormField
          id="newPassword"
          label="New password"
          cue={`Minimum ${AUTH_PASSWORD_MIN_LENGTH} characters`}
          error={errors.newPassword?.message}
        >
          <FormInput
            id="newPassword"
            type="password"
            autoComplete="new-password"
            error={!!errors.newPassword}
            {...register("newPassword")}
          />
        </FormField>
        <FormField id="confirmPassword" label="Confirm new password" error={errors.confirmPassword?.message}>
          <FormInput
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            error={!!errors.confirmPassword}
            {...register("confirmPassword")}
          />
        </FormField>
      </FormSection>
      <FormActions
        control={control}
        isSubmitting={mutation.isPending}
        errorMessage={serverError}
        submitLabel="Change password"
        sticky={false}
      />
    </form>
  );
}
