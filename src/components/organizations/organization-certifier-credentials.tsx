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
import {
  CheckCircleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react/dist/ssr";
import { useForm } from "react-hook-form";
import { FormActions, FormField, FormInput } from "@/components/forms";
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
import { formatDateTime } from "@/lib/format-utils";

interface OrganizationCertifierCredentialsProps {
  organizationId: string;
  organizationName: string;
}

export function OrganizationCertifierCredentials({
  organizationId,
  organizationName,
}: OrganizationCertifierCredentialsProps) {
  const statusQuery = useOrgCertifierCredentialsStatus(organizationId);

  if (statusQuery.isLoading) {
    return <Skeleton className="h-160 w-full" />;
  }

  if (statusQuery.error) {
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
      // Remount when the stored state flips so the masked defaults reseed.
      key={configured ? "configured" : "empty"}
      organizationId={organizationId}
      configured={configured}
      accessTokenLast4={status?.accessTokenLast4 ?? null}
      updatedAt={status?.updatedAt ?? null}
    />
  );
}

function CredentialsForm({
  organizationId,
  configured,
  accessTokenLast4,
  updatedAt,
}: {
  organizationId: string;
  configured: boolean;
  accessTokenLast4: string | null;
  updatedAt: Date | null;
}) {
  const toast = useToast();
  const setCredentials = useSetOrgCertifierCredentials(organizationId);
  const [serverError, setServerError] = useState("");
  const [verification, setVerification] =
    useState<CertifierCredentialsVerification | null>(null);

  const {
    register,
    handleSubmit,
    reset,
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
      setVerification(result.verification);
      // The toast confirms the write; the panel below carries the connection
      // outcome, which is the part worth reading twice.
      toast.success("Isometric keys saved.");
    } catch (error) {
      setServerError(
        error instanceof Error
          ? error.message
          : "Failed to save the Isometric keys.",
      );
    }
  }

  const savedCaption = configured
    ? [
        accessTokenLast4 ? `Ends ${accessTokenLast4}` : null,
        updatedAt ? `saved ${formatDateTime(updatedAt)}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : undefined;

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="content-measure-form flex flex-col gap-16"
    >
      <div className="grid grid-cols-1 gap-16 md:grid-cols-2">
        <FormField
          id={`isometric-access-token-${organizationId}`}
          label="Access token"
          error={errors.accessToken?.message}
          required={!configured}
          helperText={savedCaption}
        >
          <FormInput
            id={`isometric-access-token-${organizationId}`}
            type="password"
            autoComplete="new-password"
            disabled={setCredentials.isPending}
            {...register("accessToken")}
          />
        </FormField>
        <FormField
          id={`isometric-client-secret-${organizationId}`}
          label="Client secret"
          error={errors.clientSecret?.message}
          required={!configured}
          helperText={configured ? "Saved" : undefined}
        >
          <FormInput
            id={`isometric-client-secret-${organizationId}`}
            type="password"
            autoComplete="new-password"
            disabled={setCredentials.isPending}
            {...register("clientSecret")}
          />
        </FormField>
      </div>

      {verification && <VerificationNotice verification={verification} />}

      <FormActions
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
 * What Isometric said when the saved keys were used. A failure is not a form
 * error — the keys were stored — so it does not go through `ServerError`, which
 * would claim the save did not happen.
 */
function VerificationNotice({
  verification,
}: {
  verification: CertifierCredentialsVerification;
}) {
  // Written out per branch, never interpolated: Tailwind resolves class names
  // by scanning source text, so a composed `bg-[var(${tone}-bg)]` generates no
  // rule at all.
  const { Icon, container, icon } = verification.ok
    ? {
        Icon: CheckCircleIcon,
        container: "border-[var(--st-ok-border)] bg-[var(--st-ok-bg)]",
        icon: "text-[var(--st-ok)]",
      }
    : {
        Icon: WarningCircleIcon,
        container: "border-[var(--st-wait-border)] bg-[var(--st-wait-bg)]",
        icon: "text-[var(--st-wait)]",
      };

  return (
    <div
      role="status"
      className={`flex items-start gap-8 border p-12 ${container}`}
    >
      <Icon
        size={16}
        weight="fill"
        aria-hidden
        className={`mt-2 shrink-0 ${icon}`}
      />
      <p className="body-small text-[var(--color-text-primary)]">
        {verification.message}
      </p>
    </div>
  );
}

/** `undefined` when the field still holds the mask or was left blank. */
function changedValue(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || trimmed === CERTIFIER_CREDENTIAL_MASK) return undefined;
  return trimmed;
}
