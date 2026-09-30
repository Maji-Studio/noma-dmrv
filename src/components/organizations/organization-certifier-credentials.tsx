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
import { useForm } from "react-hook-form";
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
}

export function OrganizationCertifierCredentials({
  organizationId,
  organizationName,
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
    />
  );
}

function CredentialsForm({
  organizationId,
  configured,
  accessTokenLast4,
}: {
  organizationId: string;
  configured: boolean;
  accessTokenLast4: string | null;
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
    }
  }

  const tokenSaved = configured && !replacing.accessToken;
  const secretSaved = configured && !replacing.clientSecret;
  const tokenId = `isometric-access-token-${organizationId}`;
  const secretId = `isometric-client-secret-${organizationId}`;

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="content-measure-form flex flex-col gap-16"
    >
      <div className="grid grid-cols-1 gap-16 md:grid-cols-2">
        {tokenSaved ? (
          <SavedKey
            label="Access token"
            saved={accessTokenLast4 ? `Ends ${accessTokenLast4}` : "Saved"}
            onReplace={() => startReplace("accessToken")}
          />
        ) : (
          <div className="flex flex-col gap-8">
            <FormField
              id={tokenId}
              label="Access token"
              error={errors.accessToken?.message}
              required={!configured}
            >
              <FormInput
                id={tokenId}
                type="password"
                autoComplete="new-password"
                disabled={setCredentials.isPending}
                {...register("accessToken")}
              />
            </FormField>
            {configured && (
              <CancelReplace onClick={() => cancelReplace("accessToken")} />
            )}
          </div>
        )}
        {secretSaved ? (
          <SavedKey
            label="Client secret"
            saved="Saved"
            onReplace={() => startReplace("clientSecret")}
          />
        ) : (
          <div className="flex flex-col gap-8">
            <FormField
              id={secretId}
              label="Client secret"
              error={errors.clientSecret?.message}
              required={!configured}
            >
              <FormInput
                id={secretId}
                type="password"
                autoComplete="new-password"
                disabled={setCredentials.isPending}
                {...register("clientSecret")}
              />
            </FormField>
            {configured && (
              <CancelReplace onClick={() => cancelReplace("clientSecret")} />
            )}
          </div>
        )}
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

/** A stored key: only its last characters are ever shown, never the secret. */
function SavedKey({
  label,
  saved,
  onReplace,
}: {
  label: string;
  saved: string;
  onReplace: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <span className="body-small font-medium text-[var(--color-text-primary)]">
        {label}
      </span>
      <div className="flex items-center justify-between gap-12 border border-[var(--color-border-secondary)] bg-[var(--color-surface-light)] px-12 py-8">
        <span className="body-small text-[var(--color-text-secondary)]">
          {saved}
        </span>
        <Button type="button" variant="weak" size="small" onClick={onReplace}>
          Replace
        </Button>
      </div>
    </div>
  );
}

function CancelReplace({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="weak" size="small" onClick={onClick} className="self-start">
      Keep saved key
    </Button>
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
