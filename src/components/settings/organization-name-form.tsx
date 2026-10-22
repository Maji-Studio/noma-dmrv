/**
 * The organization's name on Settings, General (#1277 wave 2, Q5). Admins
 * and Platform Admins rename it in place; members read it. Save appears only
 * once the name differs from the saved one, like the durability tier on
 * Settings, Facilities.
 *
 * The slug is not shown (Q6): nothing an operator sees reads it, and the
 * server regenerates it from the new name.
 *
 * The saved name reaches every surface through a router refresh (the layout's
 * Platform Admin bar and this pane's scope line) and the hook's cache
 * invalidation (the sidebar brand, the switcher, the organizations list).
 */
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { FormActions, FormField, FormInput } from "@/components/forms";
import { DetailField } from "@/components/ui/detail-panel";
import { useToast } from "@/components/ui/toast";
import { useLatchedSubmit } from "@/hooks/use-latched-submit";
import { useRenameOrganization } from "@/hooks/use-organizations";
import {
  ORGANIZATION_NAME_MAX_LENGTH,
  renameOrganizationSchema,
  type RenameOrganizationInput,
} from "@/schemas/organizations";

export function OrganizationNameForm({
  name,
  canManage,
}: {
  name: string;
  canManage: boolean;
}) {
  if (!canManage) return <DetailField label="Name" value={name} />;
  return <NameForm savedName={name} />;
}

function NameForm({ savedName }: { savedName: string }) {
  const router = useRouter();
  const toast = useToast();
  const rename = useRenameOrganization();
  const [serverError, setServerError] = useState("");
  // The name this form last saved, ahead of the refreshed prop, so Rename does
  // not come back between the save and the page refresh.
  const [baseline, setBaseline] = useState(savedName);
  const [lastProp, setLastProp] = useState(savedName);
  if (savedName !== lastProp) {
    setLastProp(savedName);
    setBaseline(savedName);
  }
  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<RenameOrganizationInput>({
    resolver: zodResolver(renameOrganizationSchema),
    defaultValues: { name: savedName },
    // A refreshed name (this save, another tab) replaces the baseline without
    // overwriting a name the operator is still typing.
    values: { name: savedName },
    resetOptions: { keepDirtyValues: true },
  });
  const typed = useWatch({ control, name: "name" }) ?? baseline;
  const changed = typed.trim() !== baseline;

  const latched = useLatchedSubmit();
  const onSubmit = latched(handleSubmit(async (values) => {
    setServerError("");
    try {
      const renamed = await rename.mutateAsync(values);
      setBaseline(renamed.name);
      reset({ name: renamed.name });
      toast.success(`Organization renamed to ${renamed.name}.`);
      router.refresh();
    } catch (error) {
      setServerError(
        error instanceof Error ? error.message : "The organization was not renamed. Try again.",
      );
    }
  }));

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-16">
      <FormField
        id="organization-name"
        label="Name"
        required
        error={errors.name?.message}
      >
        <FormInput
          id="organization-name"
          type="text"
          autoComplete="organization"
          maxLength={ORGANIZATION_NAME_MAX_LENGTH}
          error={!!errors.name}
          disabled={rename.isPending}
          {...register("name", {
            // A refusal belongs to the name that was sent, not the one being typed.
            onChange: () => setServerError(""),
          })}
        />
      </FormField>
      <FormActions
        control={control}
        isSubmitting={rename.isPending}
        errorMessage={serverError}
        showSubmit={changed}
        submitLabel="Rename organization"
        submittingLabel="Renaming…"
        sticky={false}
      />
    </form>
  );
}
