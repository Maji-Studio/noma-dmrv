/**
 * OrganizationsAdmin — Platform Admin directory of all Organizations.
 * Enter any org (sets the session's active org), and create organizations.
 */
"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { BuildingsIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { FormActions, FormField, FormInput } from "@/components/forms";
import { useToast } from "@/components/ui/toast";
import {
  useAllOrganizations,
  useAllOrganizationApiAccess,
  useCreateOrganization,
  useEnterOrganization,
} from "@/hooks/use-organizations";
import { createOrganizationSchema } from "@/schemas/organizations";
import { OrganizationAdminRow } from "./organization-admin-row";
import { OrganizationRosterList } from "./organization-roster-list";

type CreateForm = z.infer<typeof createOrganizationSchema>;

export function OrganizationsAdmin() {
  const toast = useToast();
  const { data: organizations, isLoading } = useAllOrganizations();
  const apiAccess = useAllOrganizationApiAccess();
  const apiAccessByOrg = new Map((apiAccess.isError ? undefined : apiAccess.data)?.map((row) => [row.organizationId, row.enabled]));
  const createOrg = useCreateOrganization();
  const enterOrganization = useEnterOrganization();
  const [enteringId, setEnteringId] = useState<string | null>(null);

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateForm>({ resolver: zodResolver(createOrganizationSchema) });

  async function onCreate(values: CreateForm) {
    try {
      await createOrg.mutateAsync(values);
      toast.success("Organization created.");
      reset({ name: "", slug: "", ownerEmail: "" });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Organization was not created. Check the form."
      );
    }
  }

  async function enterOrg(organizationId: string) {
    setEnteringId(organizationId);
    try {
      const result = await enterOrganization(organizationId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
    } finally {
      setEnteringId(null);
    }
  }

  return (
    <div className="flex flex-col gap-32">
      <section className="flex flex-col gap-16">
        <h2 className="title-heading-3">Organizations</h2>
        {apiAccess.isError && (
          <Notice tone="error" action={
            <Button type="button" variant="weak" size="small" busy={apiAccess.isFetching} onClick={() => apiAccess.refetch()}>
              Retry
            </Button>
          }>
            API access could not be loaded. Retry to view or change it.
          </Notice>
        )}
        {isLoading || apiAccess.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : !organizations || organizations.length === 0 ? (
          <EmptyState
            icon={<BuildingsIcon size={40} />}
            title="No organizations yet"
            description="Create the first organization to onboard an operator."
            padding="md"
          />
        ) : (
          <OrganizationRosterList>
            {organizations.map((org) => (
              <OrganizationAdminRow
                key={org.id}
                org={org}
                apiAccessEnabled={apiAccessByOrg.get(org.id)}
                entering={enteringId === org.id}
                onEnter={() => enterOrg(org.id)}
              />
            ))}
          </OrganizationRosterList>
        )}
      </section>

      <section className="flex flex-col gap-16">
        <h2 className="title-heading-3">Create organization</h2>
        <form
          onSubmit={handleSubmit(onCreate)}
          className="content-measure-form flex flex-col gap-16 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-20"
        >
          <FormField
            id="org-name"
            label="Name"
            error={errors.name?.message}
            required
          >
            <FormInput
              id="org-name"
              placeholder="Dark Earth Carbon"
              {...register("name")}
            />
          </FormField>
          <FormField
            id="org-slug"
            label="Slug"
            error={errors.slug?.message}
            required
          >
            <FormInput
              id="org-slug"
              placeholder="dark-earth-carbon"
              {...register("slug")}
            />
          </FormField>
          <FormField
            id="org-owner-email"
            label="Owner email"
            error={errors.ownerEmail?.message}
            cue="Must be an existing user account; they become the org Owner."
            required
          >
            <FormInput
              id="org-owner-email"
              type="email"
              placeholder="owner@example.com"
              {...register("ownerEmail")}
            />
          </FormField>
          <FormActions
            control={control}
            isSubmitting={createOrg.isPending}
            submitLabel="Create organization"
            submittingLabel="Creating…"
            sticky={false}
          />
        </form>
      </section>
    </div>
  );
}
