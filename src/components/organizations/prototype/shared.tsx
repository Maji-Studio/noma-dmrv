/**
 * PROTOTYPE (#1373, branch prototype/platform-organizations, never merge).
 * Shared data and dialogs for the Platform Organizations variants.
 */
"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/ui/form-dialog";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { FormActions, FormField, FormInput } from "@/components/forms";
import { useViewerOrg } from "@/components/navigation";
import { useBusyUntilUnload } from "@/hooks/use-busy-until-unload";
import { useOrgCertifierCredentialsStatus } from "@/hooks/use-certifier-credentials";
import {
  ORG_SWITCH_FAILED_MESSAGE,
  useAllOrganizationApiAccess,
  useAllOrganizations,
  useCreateOrganization,
  useEnterOrganization,
  useSetOrganizationApiAccess,
} from "@/hooks/use-organizations";
import { organizationSlugBase } from "@/lib/organizations/organization-slug";
import { OrganizationCertifierCredentials } from "../organization-certifier-credentials";

export interface OrgRow {
  id: string;
  name: string;
  memberCount: number;
  apiAccess: boolean | undefined;
  current: boolean;
}

export function membersLabel(count: number): string {
  if (count === 0) return "No members";
  return `${count} member${count === 1 ? "" : "s"}`;
}

/** The directory every variant renders, plus the open action. */
export function useOrgDirectory() {
  const toast = useToast();
  const organizations = useAllOrganizations();
  const apiAccess = useAllOrganizationApiAccess();
  const enter = useEnterOrganization();
  const entering = useBusyUntilUnload<string>();
  const activeId = useViewerOrg()?.organizationId ?? null;
  const apiByOrg = new Map((apiAccess.isError ? undefined : apiAccess.data)?.map((r) => [r.organizationId, r.enabled]));
  const rows: OrgRow[] = (organizations.data ?? []).map((org) => ({
    id: org.id,
    name: org.name,
    memberCount: org.memberCount,
    apiAccess: apiByOrg.get(org.id),
    current: org.id === activeId,
  }));

  async function open(row: OrgRow) {
    if (entering.held) return;
    entering.hold(row.id);
    try {
      const result = await enter(row.id, row.name);
      if (!result.success) {
        entering.release();
        toast.error(result.error);
      }
    } catch {
      entering.release();
      toast.error(ORG_SWITCH_FAILED_MESSAGE);
    }
  }

  return {
    rows,
    isLoading: organizations.isLoading || apiAccess.isLoading,
    apiAccessFailed: apiAccess.isError,
    retryApiAccess: () => apiAccess.refetch(),
    entering: entering.held,
    open,
  };
}

export function useKeysSaved(organizationId: string): boolean | undefined {
  const status = useOrgCertifierCredentialsStatus(organizationId);
  return status.data?.configured;
}

const createSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters."),
  adminEmail: z.email("Enter the email of an existing account."),
});
type CreateValues = z.infer<typeof createSchema>;

/** Create without a slug field: the slug follows the name, as on rename (#1367). */
export function CreateOrganizationForm({ onDone, onCancel }: { onDone?: () => void; onCancel?: () => void }) {
  const toast = useToast();
  const create = useCreateOrganization();
  const { control, register, handleSubmit, reset, formState: { errors } } = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: "", adminEmail: "" },
  });

  const submit = handleSubmit(async (values) => {
    try {
      await create.mutateAsync({ ...values, slug: organizationSlugBase(values.name) });
      toast.success(`${values.name} created.`);
      reset();
      onDone?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The organization was not created. Try again.");
    }
  });

  return (
    <form onSubmit={submit} className="flex flex-col gap-16">
      <FormField id="proto-org-name" label="Name" error={errors.name?.message} required>
        <FormInput id="proto-org-name" placeholder="Kilombero Carbon" {...register("name")} />
      </FormField>
      <FormField
        id="proto-org-admin"
        label="First Admin"
        error={errors.adminEmail?.message}
        cue="The email of someone who already has an account. They can invite the rest of their team."
        required
      >
        <FormInput id="proto-org-admin" type="email" placeholder="name@example.com" {...register("adminEmail")} />
      </FormField>
      <FormActions
        control={control}
        isSubmitting={create.isPending}
        submitLabel="Create organization"
        submittingLabel="Creating…"
        onCancel={onCancel}
        sticky={false}
      />
    </form>
  );
}

export function CreateOrganizationDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  return (
    <FormDialog isOpen={isOpen} onClose={onClose} ariaLabelledBy="proto-create-org" width="md">
      <div className="flex flex-col gap-16">
        <h2 id="proto-create-org" className="title-heading-3">New organization</h2>
        <CreateOrganizationForm onDone={onClose} onCancel={onClose} />
      </div>
    </FormDialog>
  );
}

export function KeysDialog({ org, isOpen, onClose }: { org: OrgRow; isOpen: boolean; onClose: () => void }) {
  const [saving, setSaving] = useState(false);
  const titleId = `proto-keys-${org.id}`;
  return (
    <FormDialog isOpen={isOpen} onClose={onClose} dismissible={!saving} dismissOnClickOutside={!saving} ariaLabelledBy={titleId} width="md">
      <div className="flex flex-col gap-16">
        <h2 id={titleId} className="title-heading-3">Isometric keys for {org.name}</h2>
        <OrganizationCertifierCredentials organizationId={org.id} organizationName={org.name} onSavingChange={setSaving} />
      </div>
    </FormDialog>
  );
}

/** Turning API access on is immediate; turning it off asks first. */
export function useApiAccessToggle(org: OrgRow) {
  const toast = useToast();
  const mutation = useSetOrganizationApiAccess();
  const [confirmOff, setConfirmOff] = useState(false);

  async function set(enabled: boolean) {
    try {
      await mutation.mutateAsync({ id: org.id, enabled });
      setConfirmOff(false);
      toast.success(`API access turned ${enabled ? "on" : "off"} for ${org.name}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "API access was not changed. Try again.");
    }
  }

  const request = () => (org.apiAccess ? setConfirmOff(true) : set(true));
  const dialog = (
    <Modal
      isOpen={confirmOff}
      onClose={() => setConfirmOff(false)}
      dismissible={!mutation.isPending}
      ariaLabelledBy={`proto-api-off-${org.id}`}
      width="sm"
    >
      <div className="flex flex-col gap-16">
        <h2 id={`proto-api-off-${org.id}`} className="title-heading-3">Turn API access off for {org.name}?</h2>
        <p className="body-small text-[var(--color-text-secondary)]">
          Every API key in this organization stops working until API access is turned back on. The keys are not revoked.
        </p>
        <div className="flex flex-wrap gap-8">
          <Button type="button" busy={mutation.isPending} onClick={() => set(false)}>Turn API access off</Button>
          <Button type="button" variant="weak" disabled={mutation.isPending} onClick={() => setConfirmOff(false)}>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
  return { request, pending: mutation.isPending, dialog, label: org.apiAccess ? "Turn API access off" : "Turn API access on" };
}

/** Filter rows by a search query on the name. */
export function filterRows(rows: OrgRow[], query: string): OrgRow[] {
  const q = query.trim().toLowerCase();
  return q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;
}
