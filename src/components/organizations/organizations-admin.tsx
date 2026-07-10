/**
 * OrganizationsAdmin — Platform Admin directory of all Organizations.
 * Enter any org (sets the session's active org), and create the first org.
 *
 * PR 1 isolation gate: creating a SECOND org is blocked server-side until
 * org-scoped domain data ships (multi-tenancy PR 2), because a second org would
 * otherwise see PR-1's still-shared data. The form reflects that here.
 */
"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { BuildingsIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField, FormInput } from "@/components/forms";
import { useToast } from "@/components/ui/toast";
import {
  useAllOrganizations,
  useCreateOrganization,
  useEnterOrganization,
} from "@/hooks/use-organizations";

const createSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters."),
  slug: z
    .string()
    .trim()
    .regex(
      /^[a-z0-9-]+$/,
      "Lowercase letters, numbers, and hyphens only."
    ),
  ownerEmail: z.email("Enter a valid owner email."),
});
type CreateForm = z.infer<typeof createSchema>;

export function OrganizationsAdmin() {
  const toast = useToast();
  const { data: organizations, isLoading } = useAllOrganizations();
  const createOrg = useCreateOrganization();
  const enterOrganization = useEnterOrganization();
  const [enteringId, setEnteringId] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateForm>({ resolver: zodResolver(createSchema) });

  const hasExistingOrg = (organizations?.length ?? 0) >= 1;

  async function onCreate(values: CreateForm) {
    try {
      await createOrg.mutateAsync(values);
      toast.success("Organization created.");
      reset({ name: "", slug: "", ownerEmail: "" });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create organization."
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
        {isLoading ? (
          <div className="h-64 animate-pulse bg-[var(--color-background-medium)]" />
        ) : !organizations || organizations.length === 0 ? (
          <EmptyState
            icon={<BuildingsIcon size={40} />}
            title="No organizations yet"
            description="Create the first organization to onboard an operator."
            padding="md"
          />
        ) : (
          <ul className="flex flex-col border border-[var(--color-border-secondary)] bg-[var(--color-background-white)]">
            {organizations.map((org) => (
              <li
                key={org.id}
                className="flex flex-wrap items-center justify-between gap-12 border-b border-[var(--color-border-tertiary)] px-16 py-12 last:border-b-0"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="body-small font-medium text-[var(--color-text-primary)] truncate">
                    {org.name}
                  </span>
                  <span className="body-caption text-[var(--color-text-secondary)] truncate">
                    {org.slug} · {org.memberCount} member
                    {org.memberCount === 1 ? "" : "s"}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="weak"
                  size="small"
                  onClick={() => enterOrg(org.id)}
                  disabled={enteringId === org.id}
                >
                  {enteringId === org.id ? "Entering…" : "Enter"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-16">
        <h2 className="title-heading-3">Create organization</h2>
        {hasExistingOrg ? (
          <p className="body-small text-[var(--color-text-secondary)] border border-dashed border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-16">
            Creating additional organizations is disabled until org-scoped data
            ships (multi-tenancy PR 2). A second organization would otherwise see
            the platform&apos;s still-shared data.
          </p>
        ) : (
          <form
            onSubmit={handleSubmit(onCreate)}
            className="flex flex-col gap-16 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-20"
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
              helperText="Must be an existing user account; they become the org Owner."
              required
            >
              <FormInput
                id="org-owner-email"
                type="email"
                placeholder="owner@example.com"
                {...register("ownerEmail")}
              />
            </FormField>
            <div>
              <Button
                type="submit"
                variant="primary"
                disabled={createOrg.isPending}
              >
                {createOrg.isPending ? "Creating…" : "Create organization"}
              </Button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
