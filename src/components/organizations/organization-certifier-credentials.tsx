"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useForm } from "react-hook-form";
import {
  FormActions,
  FormField,
  FormInput,
  ServerError,
} from "@/components/forms";
import { Button } from "@/components/ui/button";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import {
  useOrgCertifierCredentialsStatus,
  useRemoveOrgCertifierCredentials,
  useSetOrgCertifierCredentials,
} from "@/hooks/use-certifier-credentials";
import {
  certifierCredentialsFormSchema,
  type CertifierCredentialsFormInput,
} from "@/schemas/organizations";

interface OrganizationCertifierCredentialsProps {
  organizationId: string;
  organizationName: string;
}

function formatUpdatedAt(value: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function OrganizationCertifierCredentials({
  organizationId,
  organizationName,
}: OrganizationCertifierCredentialsProps) {
  const toast = useToast();
  const statusQuery = useOrgCertifierCredentialsStatus(organizationId);
  const setCredentials = useSetOrgCertifierCredentials(organizationId);
  const removeCredentials = useRemoveOrgCertifierCredentials(organizationId);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [serverError, setServerError] = useState("");
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CertifierCredentialsFormInput>({
    resolver: zodResolver(certifierCredentialsFormSchema),
    defaultValues: { accessToken: "", clientSecret: "" },
  });

  async function onSubmit(values: CertifierCredentialsFormInput) {
    setServerError("");
    try {
      await setCredentials.mutateAsync(values);
      reset({ accessToken: "", clientSecret: "" });
      toast.success("Isometric credentials saved.");
    } catch (error) {
      setServerError(
        error instanceof Error
          ? error.message
          : "Failed to save Isometric credentials.",
      );
    }
  }

  async function confirmRemoval() {
    setServerError("");
    try {
      await removeCredentials.mutateAsync();
      toast.success("Isometric credentials removed.");
    } catch (error) {
      setServerError(
        error instanceof Error
          ? error.message
          : "Failed to remove Isometric credentials.",
      );
    } finally {
      setConfirmingRemoval(false);
    }
  }

  const status = statusQuery.data;

  return (
    <section className="flex flex-col gap-16 border-t border-[var(--color-border-tertiary)] p-16">
      <div className="flex flex-wrap items-start justify-between gap-12">
        <div className="flex flex-col gap-4">
          <h3 className="body-small font-medium text-[var(--color-text-primary)]">
            Isometric credentials
          </h3>
          <p className="body-caption text-[var(--color-text-secondary)]">
            Write-only credentials used for this organization’s registry calls.
          </p>
        </div>
        {status?.configured && (
          <StatusBadge status="complete" label="Configured" size="small" />
        )}
      </div>

      {statusQuery.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : statusQuery.error ? (
        <EmptyState
          icon={<WarningCircleIcon size={32} />}
          title="Credential status unavailable"
          description={statusQuery.error.message}
          padding="sm"
        />
      ) : status?.configured ? (
        <div className="flex flex-wrap items-center justify-between gap-12 border border-[var(--color-border-tertiary)] bg-[var(--color-background-medium)] p-12">
          <div className="flex flex-col gap-4">
            <span className="body-small font-mono text-[var(--color-text-primary)]">
              Access token …{status.accessTokenLast4}
            </span>
            {status.updatedAt && (
              <span className="body-caption text-[var(--color-text-secondary)]">
                Updated {formatUpdatedAt(status.updatedAt)}
              </span>
            )}
          </div>
          <Button
            type="button"
            variant="weak"
            size="small"
            onClick={() => setConfirmingRemoval(true)}
          >
            Remove
          </Button>
        </div>
      ) : (
        <EmptyState
          icon={<KeyIcon size={32} />}
          title="Isometric credentials not configured"
          description="Add this organization’s access token and client secret before submitting live certification data."
          padding="sm"
        />
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-16">
        <div className="grid grid-cols-1 gap-16 md:grid-cols-2">
          <FormField
            id={`isometric-access-token-${organizationId}`}
            label="Access token"
            error={errors.accessToken?.message}
            required
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
            required
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
        <ServerError message={serverError} />
        <FormActions
          isSubmitting={setCredentials.isPending}
          submitLabel={
            status?.configured ? "Replace credentials" : "Set credentials"
          }
          submittingLabel="Saving…"
          sticky={false}
        />
      </form>

      <DeleteConfirmDialog
        isOpen={confirmingRemoval}
        title="Remove Isometric credentials"
        message={`Remove the Isometric credentials for ${organizationName}? Live certification calls for this organization will stop until replacements are configured.`}
        onConfirm={confirmRemoval}
        onCancel={() => setConfirmingRemoval(false)}
        isPending={removeCredentials.isPending}
      />
    </section>
  );
}
