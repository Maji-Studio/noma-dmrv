/**
 * OrganizationCertifierCredentials — the organization's write-only Isometric
 * keys. Every facility in the organization submits with them.
 *
 * The inputs are always on screen. Once keys are stored, each field is seeded
 * with a masked stand-in so the form reads as "filled" rather than empty, and
 * replacing a key is what it looks like: select the mask, type over it. A field
 * left at its mask is sent as `undefined`, which the data-access layer reads as
 * "keep the stored value" — so rotating only the access token does not mean
 * retyping the client secret.
 *
 * There is no separate connect-and-test step. Saving IS the test: the action
 * stores the keys and then asks Isometric to list the organization's projects
 * with them, and reports what came back. Keys that cannot list projects are not
 * "saved, fine" — they are broken, and the operator is standing right there
 * able to fix them. The write happens first regardless, so a registry outage
 * never costs someone their typing.
 *
 * The previous shape — a stored-credential summary row with a Remove button
 * above an empty form — said the same thing twice and made the common case
 * (paste a new key) the least obvious one.
 */
"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type UseFormRegisterReturn } from "react-hook-form";
import { FormActions, FormField, FormInput } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { useToast } from "@/components/ui/toast";
import type { CertifierCredentialsVerification } from "@/fn/certifier-credentials";
import {
  useOrgCertifierCredentialsStatus,
  useSetOrgCertifierCredentials,
} from "@/hooks/use-certifier-credentials";
import {
  CERTIFIER_CREDENTIAL_MASK,
  certifierCredentialsFormSchema,
  certifierCredentialsRotationSchema,
  type CertifierCredentialsFormInput,
} from "@/schemas/organizations";
import { Notice } from "@/components/ui/notice";

interface OrganizationCertifierCredentialsProps {
  organizationId: string;
  organizationName: string;
  /** Lets a host (a dismissible modal) hold itself open while keys save. */
  onSavingChange?: (saving: boolean) => void;
}

export function OrganizationCertifierCredentials({
  organizationId,
  organizationName,
  onSavingChange,
}: OrganizationCertifierCredentialsProps) {
  const statusQuery = useOrgCertifierCredentialsStatus(organizationId);

  if (statusQuery.isLoading && !statusQuery.data) {
    return <Skeleton className="h-160 w-full" />;
  }

  if (statusQuery.error && !statusQuery.data) {
    return (
      <p className="body-small text-[var(--st-bad)]" role="alert">
        Couldn&apos;t read the credential status for {organizationName}.
        {" "}
        {statusQuery.error.message}
      </p>
    );
  }

  const status = statusQuery.data;
  const configured = status?.configured ?? false;

  return (
    <CredentialsForm
      organizationId={organizationId}
      configured={configured}
      accessTokenLast4={status?.accessTokenLast4 ?? null}
      onSavingChange={onSavingChange}
    />
  );
}

function CredentialsForm({
  organizationId,
  configured,
  accessTokenLast4,
  onSavingChange,
}: {
  organizationId: string;
  configured: boolean;
  accessTokenLast4: string | null;
  onSavingChange?: (saving: boolean) => void;
}) {
  const toast = useToast();
  const setCredentials = useSetOrgCertifierCredentials(organizationId);
  const [serverError, setServerError] = useState("");
  const [verification, setVerification] =
    useState<CertifierCredentialsVerification | null>(null);
  // A saved key shows as "Ends 1a2b · Replace"; its input only appears once
  // the operator asks to replace it. Untouched keys keep the mask, which the
  // submit handler reads as "keep the stored value".
  const [replacing, setReplacing] = useState({
    accessToken: false,
    clientSecret: false,
  });

  function startReplace(field: keyof typeof replacing) {
    setValue(field, "");
    setReplacing((current) => ({ ...current, [field]: true }));
  }

  function cancelReplace(field: keyof typeof replacing) {
    setValue(field, CERTIFIER_CREDENTIAL_MASK);
    setReplacing((current) => ({ ...current, [field]: false }));
  }

  const {
    control,
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<CertifierCredentialsFormInput>({
    resolver: zodResolver(
      configured
        ? certifierCredentialsRotationSchema
        : certifierCredentialsFormSchema,
    ),
    defaultValues: configured
      ? {
          accessToken: CERTIFIER_CREDENTIAL_MASK,
          clientSecret: CERTIFIER_CREDENTIAL_MASK,
        }
      : { accessToken: "", clientSecret: "" },
  });

  async function onSubmit(values: CertifierCredentialsFormInput) {
    setServerError("");
    setVerification(null);

    // An untouched mask — and a field cleared but never retyped — both mean
    // "leave this one alone". Sending the mask would store bullets as a key.
    const accessToken = changedValue(values.accessToken);
    const clientSecret = changedValue(values.clientSecret);

    if (!accessToken && !clientSecret) {
      setServerError(
        "Type over a key to replace it, then save. Nothing has changed yet.",
      );
      return;
    }

    onSavingChange?.(true);
    try {
      const result = await setCredentials.mutateAsync({
        accessToken,
        clientSecret,
      });
      reset({
        accessToken: CERTIFIER_CREDENTIAL_MASK,
        clientSecret: CERTIFIER_CREDENTIAL_MASK,
      });
      setReplacing({ accessToken: false, clientSecret: false });
      setVerification(result.verification);
      // The toast confirms the write; the panel below carries the connection
      // outcome, which is the part worth reading twice.
      toast.success("Isometric keys saved.");
    } catch (error) {
      setServerError(
        error instanceof Error
          ? error.message
          : "The Isometric keys were not saved. Try again.",
      );
    } finally {
      onSavingChange?.(false);
    }
  }

  const tokenId = `isometric-access-token-${organizationId}`;
  const secretId = `isometric-client-secret-${organizationId}`;

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="content-measure-form flex flex-col gap-16"
    >
      <div className="grid grid-cols-1 gap-16 md:grid-cols-2">
        <CredentialKeyField
          id={tokenId}
          label="Access token"
          savedText={accessTokenLast4 ? `Ends ${accessTokenLast4}` : "Saved"}
          configured={configured}
          replacing={replacing.accessToken}
          error={errors.accessToken?.message}
          disabled={setCredentials.isPending}
          onReplace={() => startReplace("accessToken")}
          onCancel={() => cancelReplace("accessToken")}
          inputProps={register("accessToken")}
        />
        <CredentialKeyField
          id={secretId}
          label="Client secret"
          savedText="Saved"
          configured={configured}
          replacing={replacing.clientSecret}
          error={errors.clientSecret?.message}
          disabled={setCredentials.isPending}
          onReplace={() => startReplace("clientSecret")}
          onCancel={() => cancelReplace("clientSecret")}
          inputProps={register("clientSecret")}
        />
      </div>

      {verification && <VerificationNotice verification={verification} />}

      <FormActions
        control={control}
        isSubmitting={setCredentials.isPending}
        errorMessage={serverError}
        submitLabel="Save keys"
        submittingLabel="Saving and connecting…"
        sticky={false}
      />
    </form>
  );
}

/**
 * One key. Saved and untouched it reads "Ends 1a2b" with a Replace action
 * (only the last characters are ever shown, never the secret); replacing it
 * swaps in an empty input with a way back to the saved key.
 */
function CredentialKeyField({
  id,
  label,
  savedText,
  configured,
  replacing,
  error,
  disabled,
  onReplace,
  onCancel,
  inputProps,
}: {
  id: string;
  label: string;
  savedText: string;
  configured: boolean;
  replacing: boolean;
  error?: string;
  disabled: boolean;
  onReplace: () => void;
  onCancel: () => void;
  inputProps: UseFormRegisterReturn;
}) {
  const showSaved = configured && !replacing;
  const noun = label.toLowerCase();

  return (
    <div className="flex flex-col gap-8">
      <FormField id={id} label={label} error={error} required={!configured}>
        {showSaved ? (
          <div
            id={id}
            role="group"
            aria-label={`${label}, saved`}
            className="flex min-h-[40px] items-center justify-between gap-12"
          >
            <span className="body-small text-[var(--color-text-secondary)]">
              {savedText}
            </span>
            <Button
              type="button"
              variant="weak"
              size="small"
              aria-label={`Replace ${noun}`}
              onClick={onReplace}
            >
              Replace
            </Button>
          </div>
        ) : (
          <FormInput
            id={id}
            type="password"
            autoComplete="new-password"
            disabled={disabled}
            {...inputProps}
          />
        )}
      </FormField>
      {configured && replacing && (
        <Button
          type="button"
          variant="weak"
          size="small"
          className="self-start"
          onClick={onCancel}
        >
          Keep saved key
        </Button>
      )}
    </div>
  );
}

/**
 * What Isometric said when the saved keys were used. A failure is not a form
 * error — the keys were stored — so it does not go through `ServerError`, which
 * would claim the save did not happen.
 */
function VerificationNotice({
  verification,
}: {
  verification: CertifierCredentialsVerification;
}) {
  return (
    <Notice tone={verification.ok ? "success" : "warning"}>
      {verification.message}
    </Notice>
  );
}

/** `undefined` when the field still holds the mask or was left blank. */
function changedValue(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || trimmed === CERTIFIER_CREDENTIAL_MASK) return undefined;
  return trimmed;
}
