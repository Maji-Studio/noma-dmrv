/**
 * OrganizationsAdmin — Platform Admin directory of all Organizations.
 * Open any org (sets the session's active org), and create organizations.
 */
"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { BuildingsIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { useBusyUntilUnload } from "@/hooks/use-busy-until-unload";
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
import { useViewerOrg } from "@/components/navigation";
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
  // The Open button stays busy until the page reloads into the organization; only a failure clears it.
  const entering = useBusyUntilUnload<string>();
  const activeOrganizationId = useViewerOrg()?.organizationId ?? null;

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
      reset({ name: "", slug: "", adminEmail: "" });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Organization was not created. Check the form."
      );
    }
  }

  async function enterOrg(organizationId: string, organizationName: string) {
    if (entering.held) return;
    entering.hold(organizationId);
    try {
      const result = await enterOrganization(organizationId, organizationName);
      if (!result.success) {
        entering.release();
        toast.error(result.error);
      }
    } catch {
      entering.release();
      toast.error("The organization did not open. Try again.");
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
                entering={entering.held === org.id}
                enterDisabled={entering.held !== null}
                current={org.id === activeOrganizationId}
                onEnter={() => enterOrg(org.id, org.name)}
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
            id="org-admin-email"
            label="Admin email"
            error={errors.adminEmail?.message}
            cue="Must be an existing user account. They become the organization Admin."
            required
          >
            <FormInput
              id="org-admin-email"
              type="email"
              placeholder="admin@example.com"
              {...register("adminEmail")}
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
