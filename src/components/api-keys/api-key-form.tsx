"use client";

import { useLatchedSubmit } from "@/hooks/use-latched-submit";
import { useId, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, type UseFormRegisterReturn } from "react-hook-form";
import { FormActions, FormField, FormInput, FormSelect } from "@/components/forms";
import { useSaveRefusal } from "@/components/forms/use-save-refusal";
import { API_KEY_DEFAULT_EXPIRY_SECONDS, API_KEY_EXPIRY_PRESET_DAYS, API_KEY_NAME_MAX_LENGTH, SECONDS_PER_DAY } from "@/config/api-keys";
import { scopesFromPermissions } from "@/lib/auth/api-scopes";
import { toSaveErrorMessage } from "@/lib/stale-version";
import { createApiKeySchema, updateApiKeySchema, type CreateApiKeyFormInput, type CreateApiKeyInput, type UpdateApiKeyInput } from "@/schemas/api-keys";
import type { ApiKeyListItem } from "@/hooks/use-api-keys";
import { API_KEY_DEFAULT_SCOPES } from "./api-key-permissions";
import { ApiKeyPermissionGrid } from "./api-key-permission-grid";

const EXPIRY_OPTIONS = API_KEY_EXPIRY_PRESET_DAYS.map((days) => ({
  value: String(days * SECONDS_PER_DAY),
  label: `${days} days`,
}));

function NameField({ registration, error, disabled }: {
  registration: UseFormRegisterReturn<"name">;
  error?: string;
  disabled: boolean;
}) {
  return (
    <FormField id="api-key-name" label="Name" required error={error}>
      <FormInput id="api-key-name" maxLength={API_KEY_NAME_MAX_LENGTH} error={!!error} disabled={disabled} {...registration} />
    </FormField>
  );
}

export function CreateApiKeyForm({ onSubmit, onCancel, isPending }: {
  onSubmit: (values: CreateApiKeyInput) => Promise<unknown>;
  onCancel: () => void;
  isPending: boolean;
}) {
  const latched = useLatchedSubmit();
  const formId = useId();
  const [serverError, setServerError] = useState("");
  const { register, control, handleSubmit, setError, resetField, formState: { errors, isSubmitting } } = useForm<CreateApiKeyFormInput, unknown, CreateApiKeyInput>({
    resolver: zodResolver(createApiKeySchema),
    defaultValues: { name: "", scopes: [...API_KEY_DEFAULT_SCOPES], expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS },
  });
  const refuseSave = useSaveRefusal({ control, setError, resetField, formId });
  const busy = isPending || isSubmitting;

  async function submit(values: CreateApiKeyInput) {
    setServerError("");
    try { await onSubmit(values); }
    catch (error) { setServerError(refuseSave(error, toSaveErrorMessage(error, "The API key was not created. Try again.")) ?? ""); }
  }

  return (
    <form id={formId} onSubmit={latched(handleSubmit(submit))} className="flex flex-col gap-20">
      <NameField registration={register("name")} error={errors.name?.message} disabled={busy} />
      <Controller name="expiresIn" control={control} render={({ field }) => (
        <FormField id="api-key-expiry" label="Expires after" required error={errors.expiresIn?.message}>
          <FormSelect id="api-key-expiry" options={EXPIRY_OPTIONS} {...field} value={field.value as string | number} disabled={busy} error={!!errors.expiresIn} />
        </FormField>
      )} />
      <Controller name="scopes" control={control} render={({ field }) => (
        <ApiKeyPermissionGrid value={field.value} onChange={field.onChange} disabled={busy} error={errors.scopes?.message} />
      )} />
      <FormActions control={control} sticky={false} onCancel={onCancel} isSubmitting={busy} errorMessage={serverError} submitLabel="Create API key" />
    </form>
  );
}

export function EditApiKeyForm({ apiKey, onSubmit, onCancel, isPending }: {
  apiKey: ApiKeyListItem;
  onSubmit: (values: UpdateApiKeyInput) => Promise<unknown>;
  onCancel: () => void;
  isPending: boolean;
}) {
  const latched = useLatchedSubmit();
  const formId = useId();
  const [serverError, setServerError] = useState("");
  const { register, control, handleSubmit, setError, resetField, formState: { errors, isSubmitting } } = useForm<UpdateApiKeyInput>({
    resolver: zodResolver(updateApiKeySchema),
    defaultValues: { id: apiKey.id, expectedVersion: apiKey.version, name: apiKey.name ?? "", scopes: scopesFromPermissions(apiKey.permissions) },
  });
  const refuseSave = useSaveRefusal({ control, setError, resetField, formId });
  const busy = isPending || isSubmitting;

  async function submit(values: UpdateApiKeyInput) {
    setServerError("");
    try { await onSubmit(values); }
    catch (error) { setServerError(refuseSave(error, toSaveErrorMessage(error, "The API key was not saved. Try again.")) ?? ""); }
  }

  return (
    <form id={formId} onSubmit={latched(handleSubmit(submit))} className="flex flex-col gap-20">
      <NameField registration={register("name")} error={errors.name?.message} disabled={busy} />
      <Controller name="scopes" control={control} render={({ field }) => (
        <ApiKeyPermissionGrid value={field.value} onChange={field.onChange} disabled={busy} error={errors.scopes?.message} />
      )} />
      <FormActions control={control} sticky={false} onCancel={onCancel} isSubmitting={busy} errorMessage={serverError} submitLabel="Save changes" />
    </form>
  );
}
