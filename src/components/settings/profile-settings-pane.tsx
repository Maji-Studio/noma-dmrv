/**
 * Settings, You, Profile (#1277 wave 2, decisions 3 and 4; #1391): your name,
 * your email (changed by a link sent to the new address), and a password
 * change that signs out every other device. Three forms, because a name save
 * must never send a password or an address, and a password change must ask
 * for the current one.
 */
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useId, useState } from "react";
import { ActionError } from "@/lib/action-error";
import { SESSION_EXPIRED } from "@/lib/domain-errors";
import { SETTINGS_PROFILE_HREF } from "@/lib/settings/links";
import { useForm } from "react-hook-form";
import {
  FormActions,
  FormField,
  FormInput,
  FormSection,
  ResolvedErrorRevalidator,
} from "@/components/forms";
import { useSaveRefusal } from "@/components/forms/use-save-refusal";
import { SignOutAndReturn } from "@/components/auth/sign-out-and-return";
import { DetailField } from "@/components/ui/detail-panel";
import { Notice } from "@/components/ui/notice";
import { useToast } from "@/components/ui/toast";
import { useLatchedSubmit } from "@/hooks/use-latched-submit";
import { useChangeEmail, useChangePassword, useUpdateProfileName } from "@/hooks/use-profile";
import { AUTH_PASSWORD_MIN_LENGTH, SESSION_COOKIE_CACHE_SECONDS } from "@/config/auth";
import {
  changeEmailSchema,
  changePasswordSchema,
  profileNameSchema,
  type ChangeEmailFormData,
  type ChangePasswordFormData,
  type ProfileNameFormData,
} from "@/schemas/profile";

const EMAIL_NOTE = "We send a link to the new address. Your email changes when you open it.";
const EMAIL_NOT_CHANGED = "Your email was not changed. Try again.";
/** After a fresh sign-in the person lands back here, where the change was started. */
const SIGN_IN_HREF = `/login?from=${encodeURIComponent(SETTINGS_PROFILE_HREF)}`;
const LINK_EXPIRED_CODES = new Set(["TOKEN_EXPIRED", "INVALID_TOKEN", "USER_NOT_FOUND", "INVALID_USER"]);
const LINK_SIGN_IN_REQUIRED_CODE = "SIGN_IN_REQUIRED";
const LINK_WRONG_ACCOUNT_CODE = "WRONG_ACCOUNT";
const LINK_WRONG_ACCOUNT_NOTICE = "This link is for another account. Sign in as that account, then open the link again.";
const LINK_EXPIRED_NOTICE = "This link expired or was already used. Send a new one.";
const LINK_SIGN_IN_NOTICE = "Open the link again now that you are signed in. It works only for the account that asked for the change.";

/** The confirmation link's failure code (`?error=`) as a message. Unknown codes show nothing. */
function linkErrorNotice(code: string | undefined): string {
  if (code === undefined) return "";
  if (LINK_EXPIRED_CODES.has(code)) return LINK_EXPIRED_NOTICE;
  if (code === LINK_WRONG_ACCOUNT_CODE) return LINK_WRONG_ACCOUNT_NOTICE;
  if (code === LINK_SIGN_IN_REQUIRED_CODE) return LINK_SIGN_IN_NOTICE;
  return "";
}
const SIGN_OUT_MINUTES = SESSION_COOKIE_CACHE_SECONDS / 60;
const PASSWORD_NOTE = `Changing it signs you out on every other device within ${SIGN_OUT_MINUTES} minutes. This one stays signed in.`;
const PASSWORD_CHANGED = `Password changed. Other devices are signed out within ${SIGN_OUT_MINUTES} minutes.`;
const EMPTY_PASSWORDS: ChangePasswordFormData = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
};

export function ProfileSettingsPane({
  name,
  email,
  linkError,
}: {
  name: string;
  email: string;
  /** `?error=` from the email change link's redirect. */
  linkError?: string;
}) {
  return (
    <div className="content-measure-form flex flex-col gap-32">
      <NameForm name={name} />
      <EmailForm email={email} linkError={linkError} />
      <PasswordForm />
    </div>
  );
}

function NameForm({ name }: { name: string }) {
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

function EmailForm({ email, linkError }: { email: string; linkError?: string }) {
  const linkNotice = linkErrorNotice(linkError);
  const latched = useLatchedSubmit();
  const mutation = useChangeEmail();
  const [serverError, setServerError] = useState("");
  const [sessionExpired, setSessionExpired] = useState(false);
  // Held only for this page session: the server stores nothing about a pending change.
  const [pendingEmail, setPendingEmail] = useState("");
  const {
    control,
    register,
    handleSubmit,
    setValue,
    trigger,
    formState: { errors },
  } = useForm<ChangeEmailFormData>({
    resolver: zodResolver(changeEmailSchema(email)),
    defaultValues: { newEmail: "" },
  });

  const onSubmit = latched(
    handleSubmit(async (values) => {
      setServerError("");
      setSessionExpired(false);
      try {
        await mutation.mutateAsync(values);
        setPendingEmail(values.newEmail);
        setValue("newEmail", "");
      } catch (error) {
        setPendingEmail("");
        setSessionExpired(error instanceof ActionError && error.code === SESSION_EXPIRED);
        setServerError(error instanceof Error && error.message ? error.message : EMAIL_NOT_CHANGED);
      }
    }),
  );

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-24">
      <ResolvedErrorRevalidator control={control} trigger={trigger} />
      <FormSection title="Email">
        <DetailField label="Current email" value={email} />
        {pendingEmail ? (
          <Notice tone="info">
            {`We sent a link to ${pendingEmail}. Your email changes when you open it.`}
          </Notice>
        ) : (
          <>
            {linkNotice && <Notice tone="warning">{linkNotice}</Notice>}
            <p className="body-small pb-8 text-[var(--color-text-secondary)]">{EMAIL_NOTE}</p>
          </>
        )}
        <FormField id="newEmail" label="New email" required error={errors.newEmail?.message}>
          <FormInput
            id="newEmail"
            type="email"
            autoComplete="email"
            error={!!errors.newEmail}
            {...register("newEmail")}
          />
        </FormField>
      </FormSection>
      <FormActions
        control={control}
        isSubmitting={mutation.isPending}
        errorMessage={serverError}
        errorAction={sessionExpired ? <SignOutAndReturn returnTo={SIGN_IN_HREF} compact>Sign out</SignOutAndReturn> : undefined}
        submitLabel="Send link"
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
    resetField,
    trigger,
    formState: { errors },
  } = useForm<ChangePasswordFormData>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: EMPTY_PASSWORDS,
  });
  const refuseSave = useSaveRefusal({ control, setError, resetField, formId });

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
