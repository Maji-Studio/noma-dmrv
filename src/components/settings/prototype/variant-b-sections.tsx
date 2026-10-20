"use client";

/**
 * Throwaway: the sections of prototype variant B's one Organization page, and
 * B's facility sheet. Every save is a stub toast.
 */
import { useState, type ReactNode } from "react";
import { CheckCircleIcon, PlusIcon } from "@phosphor-icons/react/dist/ssr";
import { Button, Notice, SlideOverPanel } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { FormField, FormInput, FormSelect, SegmentedControl } from "@/components/forms";
import { fixtures, PROTOTYPE_SAVE_TOAST, type PrototypeFacility } from "./abd-fixtures";
import type { PrototypeActiveOrg } from "./abd-active-org";

export const B_SECTIONS = [
  { id: "b-general", label: "General" },
  { id: "b-members", label: "Members" },
  { id: "b-registry", label: "Registry" },
  { id: "b-defaults", label: "Defaults" },
  { id: "b-developer-access", label: "Developer access" },
] as const;

function useSave() {
  const toast = useToast();
  return () => toast.info(PROTOTYPE_SAVE_TOAST);
}

function BPanel({
  id,
  title,
  who,
  children,
  footer,
}: {
  id: string;
  title: string;
  who: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-80 border-[1.5px] border-[var(--clr-dark-purple-40)] bg-[var(--paper)]"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-8 border-b border-[var(--clr-dark-purple-10)] px-16 py-12 sm:px-24">
        <h2 id={`${id}-title`} className="title-heading-3">
          {title}
        </h2>
        <span className="body-caption text-[var(--color-text-tertiary)]">{who}</span>
      </div>
      <div className="flex flex-col gap-20 p-16 sm:p-24">{children}</div>
      {footer && (
        <div className="border-t border-[var(--clr-dark-purple-10)] px-16 py-12 sm:px-24">{footer}</div>
      )}
    </section>
  );
}

function BValue({ label, children, action }: { label: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid gap-4 sm:grid-cols-[200px_minmax(0,1fr)_auto] sm:items-center sm:gap-16">
      <span className="body-small text-[var(--color-text-secondary)]">{label}</span>
      <span className="body-medium min-w-0 break-words">{children}</span>
      {action && <span className="sm:justify-self-end">{action}</span>}
    </div>
  );
}

function BSegmented({ id, legend, options, initial }: { id: string; legend: string; options: readonly string[]; initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <SegmentedControl
      id={id}
      legend={legend}
      options={options.map((o) => ({ value: o, label: o }))}
      value={value}
      onValueChange={setValue}
    />
  );
}

function BSave({ active, label = "Save changes" }: { active: PrototypeActiveOrg; label?: string }) {
  const save = useSave();
  if (!active.canManage) {
    return <span className="body-caption text-[var(--color-text-tertiary)]">Owners and Admins can change these.</span>;
  }
  return (
    <Button variant="primary" onClick={save}>
      {label}
    </Button>
  );
}

export function BGeneralSection({ active }: { active: PrototypeActiveOrg }) {
  return (
    <BPanel id="b-general" title="General" who="Owners and Admins" footer={<BSave active={active} />}>
      <div className="content-measure-form flex flex-col gap-20">
        <FormField id="b-org-name" label="Organization name">
          <FormInput id="b-org-name" defaultValue={active.name} key={active.id} />
        </FormField>
        <BValue label="Slug">
          <code>{fixtures.activeOrg.slug}</code>
        </BValue>
      </div>
    </BPanel>
  );
}

export function BMembersSection({ active }: { active: PrototypeActiveOrg }) {
  const save = useSave();
  return (
    <BPanel
      id="b-members"
      title="Members"
      who="Everyone sees this list. Owners and Admins change it."
      footer={
        active.canManage ? (
          <Button variant="primary" onClick={save}>
            <PlusIcon size={16} weight="bold" aria-hidden />
            Invite member
          </Button>
        ) : undefined
      }
    >
      <ul className="flex flex-col">
        {fixtures.members.map((m) => (
          <li key={m.id} className="flex items-center gap-12 border-b border-[var(--clr-dark-purple-10)] py-10 last:border-b-0">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="body-medium truncate">{m.name}</span>
              <span className="body-small truncate text-[var(--color-text-secondary)]">{m.email}</span>
            </span>
            <span className="body-small shrink-0">{m.role}</span>
          </li>
        ))}
        {fixtures.invitations.map((invite) => (
          <li key={invite.id} className="flex items-center gap-12 py-10">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="body-medium truncate">{invite.email}</span>
              <span className="body-small text-[var(--color-text-secondary)]">Invited {invite.sent}</span>
            </span>
            {active.canManage && (
              <Button size="small" onClick={save}>
                Revoke
              </Button>
            )}
          </li>
        ))}
      </ul>
    </BPanel>
  );
}

export function BRegistrySection({
  active,
  onOpenFacilities,
}: {
  active: PrototypeActiveOrg;
  onOpenFacilities: () => void;
}) {
  const save = useSave();
  const reg = fixtures.registry;
  return (
    <BPanel id="b-registry" title="Registry" who="Owners and Admins" footer={<BSave active={active} />}>
      <BValue label="Registry">
        {reg.name} ({reg.environment})
      </BValue>
      <BValue
        label="Isometric keys"
        action={active.canManage ? <Button size="small" onClick={save}>Replace keys</Button> : undefined}
      >
        <span className="inline-flex items-center gap-6">
          <CheckCircleIcon size={16} weight="fill" className="text-[var(--st-ok)]" aria-hidden />
          Saved, {reg.keyHint}
        </span>
      </BValue>
      <BValue label="Project">
        <code>{reg.project}</code>
      </BValue>
      <BValue label="Protocol">{reg.protocol}</BValue>
      <div className="content-measure-form flex flex-col gap-20">
        <FormField id="b-template" label="Default Removal template">
          <FormSelect
            id="b-template"
            options={[{ value: reg.defaultRemovalTemplate, label: reg.defaultRemovalTemplate }]}
            defaultValue={reg.defaultRemovalTemplate}
          />
        </FormField>
        <FormField id="b-sources" label="Source visibility">
          <FormSelect
            id="b-sources"
            options={[
              { value: "private", label: "Private: verifier only" },
              { value: "public", label: "Public on the registry" },
            ]}
            defaultValue="private"
          />
        </FormField>
      </div>
      <Notice
        tone="warning"
        title={`${reg.componentsToDecide} components to decide`}
        action={
          <Button size="small" onClick={save}>
            Decide components
          </Button>
        }
      >
        Removals on this template wait until they are decided.
      </Notice>
      <Notice
        tone="info"
        action={
          <button type="button" onClick={onOpenFacilities} className="body-small underline">
            Open Facilities
          </button>
        }
      >
        Each facility links its own Isometric facility on the facility.
      </Notice>
    </BPanel>
  );
}

export function BDefaultsSection({ active }: { active: PrototypeActiveOrg }) {
  return (
    <BPanel id="b-defaults" title="Defaults" who="Owners and Admins" footer={<BSave active={active} label="Save defaults" />}>
      <div className="content-measure-form flex flex-col gap-20">
        <FormField id="b-country" label="Country">
          <FormSelect id="b-country" options={[{ value: "Tanzania", label: "Tanzania" }, { value: "Kenya", label: "Kenya" }]} defaultValue="Tanzania" />
        </FormField>
        <FormField id="b-timezone" label="Timezone">
          <FormSelect
            id="b-timezone"
            options={[{ value: "Africa/Dar_es_Salaam", label: "Africa/Dar es Salaam (EAT, UTC+3)" }]}
            defaultValue="Africa/Dar_es_Salaam"
          />
        </FormField>
        <FormField id="b-evidence" label="Application evidence">
          <BSegmented id="b-evidence" legend="Application evidence" options={["Customer location", "GIS reference"]} initial={fixtures.orgDefaults.evidenceMethod} />
        </FormField>
        <FormField id="b-packaging" label="Order packaging">
          <BSegmented id="b-packaging" legend="Order packaging" options={["Loose", "Bagged"]} initial={fixtures.orgDefaults.packaging} />
        </FormField>
      </div>
    </BPanel>
  );
}

export function BDeveloperAccessSection({ active }: { active: PrototypeActiveOrg }) {
  const save = useSave();
  return (
    <BPanel
      id="b-developer-access"
      title="Developer access"
      who="Owners and Admins"
      footer={
        active.isPlatformAdminInside ? undefined : (
          <Button variant="primary" onClick={save}>
            <PlusIcon size={16} weight="bold" aria-hidden />
            Create API key
          </Button>
        )
      }
    >
      <BValue label="API access">On, set by a Platform Admin</BValue>
      {active.isPlatformAdminInside && (
        <Notice tone="info">Platform Admins cannot own API keys. A member of {active.name} creates them.</Notice>
      )}
      {fixtures.apiKeys.map((key) => (
        <BValue key={key.id} label={key.name} action={<Button size="small" variant="destructive" onClick={save}>Revoke</Button>}>
          {key.owner}, last used {key.lastUsed}
        </BValue>
      ))}
    </BPanel>
  );
}

/** B: facility configuration lives on the facility, in its own sheet. */
export function BFacilitySheet({
  facility,
  open,
  onOpenChange,
  onOpenRegistry,
}: {
  facility: PrototypeFacility | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenRegistry: () => void;
}) {
  const save = useSave();
  return (
    <SlideOverPanel.Root open={open} onOpenChange={onOpenChange}>
      <SlideOverPanel.Content>
        {facility && (
          <>
            <SlideOverPanel.Header>
              <SlideOverPanel.Title>{facility.name}</SlideOverPanel.Title>
              <SlideOverPanel.Description>Facility</SlideOverPanel.Description>
            </SlideOverPanel.Header>
            <SlideOverPanel.Body>
              <div className="flex flex-col gap-24" key={facility.id}>
                <section className="flex flex-col gap-16">
                  <h3 className="body-small font-medium">Site</h3>
                  <FormField id="b-fac-name" label="Name">
                    <FormInput id="b-fac-name" defaultValue={facility.name} />
                  </FormField>
                  <FormField id="b-fac-country" label="Country">
                    <FormSelect id="b-fac-country" options={[{ value: "Tanzania", label: "Tanzania" }]} defaultValue={facility.country} />
                  </FormField>
                  <FormField id="b-fac-tz" label="Timezone">
                    <FormSelect
                      id="b-fac-tz"
                      options={[{ value: "Africa/Dar_es_Salaam", label: "Africa/Dar es Salaam (EAT, UTC+3)" }]}
                      defaultValue={facility.timezone}
                    />
                  </FormField>
                  <FormField id="b-fac-tier" label="Durability tier">
                    <BSegmented id="b-fac-tier" legend="Durability tier" options={["200-year", "1000-year"]} initial={facility.durabilityTier} />
                  </FormField>
                </section>
                <section className="flex flex-col gap-16 border-t border-[var(--color-border-secondary)] pt-20">
                  <h3 className="body-small font-medium">Certification</h3>
                  {facility.registryFacility ? (
                    <FormField id="b-fcl" label="Isometric facility">
                      <FormInput id="b-fcl" defaultValue={facility.registryFacility} />
                    </FormField>
                  ) : (
                    <Notice
                      tone="warning"
                      title="No Isometric facility linked"
                      action={
                        <Button size="small" onClick={save}>
                          Link Isometric facility
                        </Button>
                      }
                    >
                      Removals from {facility.name} cannot be submitted yet.
                    </Notice>
                  )}
                  <div className="flex flex-col gap-4">
                    <span className="body-small text-[var(--color-text-secondary)]">Soil temperature</span>
                    <span className="body-medium">{facility.soilTemperature}</span>
                  </div>
                  <p className="body-small text-[var(--color-text-secondary)]">
                    Project, protocol and Removal template come from the organization.{" "}
                    <button type="button" onClick={onOpenRegistry} className="underline">
                      Open Registry
                    </button>
                  </p>
                </section>
              </div>
            </SlideOverPanel.Body>
            <SlideOverPanel.Footer>
              <Button variant="primary" onClick={save}>
                Save facility
              </Button>
            </SlideOverPanel.Footer>
          </>
        )}
      </SlideOverPanel.Content>
    </SlideOverPanel.Root>
  );
}
