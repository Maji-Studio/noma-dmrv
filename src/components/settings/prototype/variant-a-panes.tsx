"use client";

/**
 * Throwaway: pane bodies for prototype variant A (one console by scope).
 * Every save is a stub toast.
 */
import { useState, type ReactNode } from "react";
import {
  CheckCircleIcon,
  DotsThreeVerticalIcon,
  PlusIcon,
  CloudIcon,
} from "@phosphor-icons/react/dist/ssr";
import { Button, DropdownMenu, EmptyState, Notice } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import {
  FormField,
  FormInput,
  FormSelect,
  SegmentedControl,
} from "@/components/forms";
import {
  fixtures,
  PROTOTYPE_SAVE_TOAST,
  type PrototypeFacility,
} from "./abd-fixtures";
import type { PrototypeActiveOrg } from "./abd-active-org";

export interface APaneProps {
  active: PrototypeActiveOrg;
  facility: PrototypeFacility;
  goTo: (pane: string) => void;
  openOrg: (orgId: string) => void;
}

function useSaveStub() {
  const toast = useToast();
  return () => toast.info(PROTOTYPE_SAVE_TOAST);
}

function ASection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-16 border-t border-[var(--color-border-secondary)] pt-20 first:border-t-0 first:pt-0">
      <h2 className="body-small font-medium">{title}</h2>
      {children}
    </section>
  );
}

function AReadRow({ label, value, action }: { label: string; value: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-16">
      <div className="flex min-w-0 flex-col gap-2">
        <span className="body-small text-[var(--color-text-secondary)]">{label}</span>
        <span className="body-medium break-words">{value}</span>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

function ASaveRow({ label = "Save changes" }: { label?: string }) {
  const save = useSaveStub();
  return (
    <div className="flex">
      <Button variant="primary" onClick={save}>
        {label}
      </Button>
    </div>
  );
}

function ASegmented({
  id,
  legend,
  options,
  initial,
}: {
  id: string;
  legend: string;
  options: readonly string[];
  initial: string;
}) {
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

const COUNTRY_OPTIONS = [
  { value: "Tanzania", label: "Tanzania" },
  { value: "Kenya", label: "Kenya" },
  { value: "Uganda", label: "Uganda" },
];
const TIMEZONE_OPTIONS = [
  { value: "Africa/Dar_es_Salaam", label: "Africa/Dar es Salaam (EAT, UTC+3)" },
  { value: "Africa/Nairobi", label: "Africa/Nairobi (EAT, UTC+3)" },
];

/* You ------------------------------------------------------------------------------------------ */

export function AProfilePane({ active }: APaneProps) {
  const save = useSaveStub();
  return (
    <div className="flex flex-col gap-24 content-measure-form">
      <FormField id="a-profile-name" label="Name">
        <FormInput id="a-profile-name" defaultValue={active.user.name} autoComplete="name" />
      </FormField>
      <AReadRow label="Email" value={active.user.email} />
      <AReadRow
        label="Password"
        value="Last changed 2 Sep 2026"
        action={<Button onClick={save}>Change password</Button>}
      />
      <ASaveRow />
    </div>
  );
}

export function AConnectedAppsPane({ active }: APaneProps) {
  const save = useSaveStub();
  if (active.isPlatformAdminInside) {
    return (
      <Notice tone="info">
        Platform Admins cannot connect apps. Apps connect for a member of {active.name}.
      </Notice>
    );
  }
  return (
    <ul className="flex flex-col">
      {fixtures.connectedApps.map((app) => (
        <li
          key={app.id}
          className="flex flex-col gap-8 border-b border-[var(--clr-dark-purple-10)] py-12 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex min-w-0 flex-col gap-2">
            <span className="body-medium">{app.name}</span>
            <span className="body-small text-[var(--color-text-secondary)]">
              {app.permissions} in {app.org}, since {app.connected}
            </span>
          </div>
          <Button variant="destructive" onClick={save}>
            Disconnect
          </Button>
        </li>
      ))}
    </ul>
  );
}

/* Organization --------------------------------------------------------------------------------- */

export function AGeneralPane({ active }: APaneProps) {
  return (
    <div className="flex flex-col gap-24 content-measure-form">
      <ASection title="Organization">
        <FormField id="a-org-name" label="Name">
          <FormInput id="a-org-name" defaultValue={active.name} key={active.id} />
        </FormField>
        <AReadRow label="Slug" value={<code>{fixtures.activeOrg.slug}</code>} />
      </ASection>
      <ASection title="Region">
        <FormField id="a-country" label="Country">
          <FormSelect id="a-country" options={COUNTRY_OPTIONS} defaultValue={fixtures.orgDefaults.country} />
        </FormField>
        <FormField id="a-timezone" label="Timezone">
          <FormSelect id="a-timezone" options={TIMEZONE_OPTIONS} defaultValue={fixtures.orgDefaults.timezone} />
        </FormField>
      </ASection>
      <ASection title="New records">
        <FormField id="a-evidence" label="Application evidence">
          <ASegmented
            id="a-evidence"
            legend="Application evidence"
            options={["Customer location", "GIS reference"]}
            initial={fixtures.orgDefaults.evidenceMethod}
          />
        </FormField>
        <FormField id="a-packaging" label="Order packaging">
          <ASegmented
            id="a-packaging"
            legend="Order packaging"
            options={["Loose", "Bagged"]}
            initial={fixtures.orgDefaults.packaging}
          />
        </FormField>
      </ASection>
      {active.canManage && <ASaveRow />}
    </div>
  );
}

export function AMembersPane({ active }: APaneProps) {
  const save = useSaveStub();
  return (
    <div className="flex flex-col gap-24">
      {active.canManage && (
        <div className="flex">
          <Button variant="primary" onClick={save}>
            <PlusIcon size={16} weight="bold" aria-hidden />
            Invite member
          </Button>
        </div>
      )}
      <ul className="flex flex-col border-t border-[var(--clr-dark-purple-10)]">
        {fixtures.members.map((member) => (
          <li
            key={member.id}
            className="flex items-center gap-12 border-b border-[var(--clr-dark-purple-10)] py-10"
          >
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="body-medium truncate">{member.name}</span>
              <span className="body-small text-[var(--color-text-secondary)] truncate">
                {member.email}
              </span>
            </div>
            {active.canManage && member.role !== "Owner" ? (
              <FormSelect
                aria-label={`Role of ${member.name}`}
                options={[
                  { value: "Admin", label: "Admin" },
                  { value: "Member", label: "Member" },
                ]}
                defaultValue={member.role}
                onChange={save}
                className="w-[128px]"
              />
            ) : (
              <span className="body-small w-[128px] px-12">{member.role}</span>
            )}
            {active.canManage && member.role !== "Owner" && (
              <DropdownMenu.Root>
                <DropdownMenu.Trigger
                  render={
                    <Button variant="noOutline" size="icon" aria-label={`Actions for ${member.name}`} />
                  }
                >
                  <DotsThreeVerticalIcon size={20} weight="bold" />
                </DropdownMenu.Trigger>
                <DropdownMenu.Content>
                  <DropdownMenu.Item destructive onClick={save}>
                    Remove from {active.name}
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            )}
          </li>
        ))}
      </ul>
      <ASection title="Invitations">
        {fixtures.invitations.map((invite) => (
          <AReadRow
            key={invite.id}
            label={`${invite.role}, sent ${invite.sent}`}
            value={invite.email}
            action={active.canManage ? <Button onClick={save}>Revoke</Button> : undefined}
          />
        ))}
      </ASection>
    </div>
  );
}

export function ARegistryPane({ active, goTo }: APaneProps) {
  const save = useSaveStub();
  const reg = fixtures.registry;
  return (
    <div className="flex flex-col gap-24 content-measure-form">
      <ASection title="Connection">
        <AReadRow label="Registry" value={`${reg.name} (${reg.environment})`} />
        <AReadRow
          label="Isometric keys"
          value={
            <span className="inline-flex items-center gap-6">
              <CheckCircleIcon size={16} weight="fill" className="text-[var(--st-ok)]" aria-hidden />
              Saved, {reg.keyHint}
            </span>
          }
          action={active.canManage ? <Button onClick={save}>Replace keys</Button> : undefined}
        />
      </ASection>
      <ASection title="Project">
        <FormField id="a-project" label="Isometric project">
          <FormInput id="a-project" defaultValue={reg.project} />
        </FormField>
        <AReadRow label="Protocol" value={reg.protocol} />
        <FormField id="a-template" label="Default Removal template">
          <FormSelect
            id="a-template"
            options={[
              { value: reg.defaultRemovalTemplate, label: reg.defaultRemovalTemplate },
              { value: "Biochar in agricultural soils (200-year)", label: "Biochar in agricultural soils (200-year)" },
            ]}
            defaultValue={reg.defaultRemovalTemplate}
          />
        </FormField>
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
      </ASection>
      <ASection title="Sources">
        <FormField id="a-visibility" label="Default visibility">
          <FormSelect
            id="a-visibility"
            options={[
              { value: "private", label: "Private: verifier only" },
              { value: "public", label: "Public on the registry" },
            ]}
            defaultValue="private"
          />
        </FormField>
      </ASection>
      <Notice
        tone="info"
        action={
          <button type="button" className="body-small underline" onClick={() => goTo("registry-link")}>
            Open Facility, Registry link
          </button>
        }
      >
        Each facility links its own Isometric facility.
      </Notice>
      {active.canManage && <ASaveRow />}
    </div>
  );
}

export function ADevelopersPane({ active, goTo }: APaneProps) {
  const save = useSaveStub();
  return (
    <div className="flex flex-col gap-24">
      <AReadRow
        label="API access"
        value="On"
        action={
          active.isPlatformAdminInside ? (
            <button type="button" className="body-small underline" onClick={() => goTo("organizations")}>
              Change in Platform, Organizations
            </button>
          ) : undefined
        }
      />
      {active.isPlatformAdminInside ? (
        <Notice tone="info">
          Platform Admins cannot own API keys. A member of {active.name} creates them.
        </Notice>
      ) : (
        <div className="flex">
          <Button variant="primary" onClick={save}>
            <PlusIcon size={16} weight="bold" aria-hidden />
            Create API key
          </Button>
        </div>
      )}
      <ul className="flex flex-col border-t border-[var(--clr-dark-purple-10)]">
        {fixtures.apiKeys.map((key) => (
          <li
            key={key.id}
            className="flex flex-col gap-8 border-b border-[var(--clr-dark-purple-10)] py-12 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 flex-col gap-2">
              <span className="body-medium">{key.name}</span>
              <span className="body-small text-[var(--color-text-secondary)]">
                {key.owner}, created {key.created}, last used {key.lastUsed}
              </span>
            </div>
            <Button variant="destructive" onClick={save}>
              Revoke
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* Facility ------------------------------------------------------------------------------------- */

export function ASitePane({ facility }: APaneProps) {
  return (
    <div className="flex flex-col gap-24 content-measure-form" key={facility.id}>
      <FormField id="a-fac-name" label="Name">
        <FormInput id="a-fac-name" defaultValue={facility.name} />
      </FormField>
      <FormField id="a-fac-country" label="Country">
        <FormSelect id="a-fac-country" options={COUNTRY_OPTIONS} defaultValue={facility.country} />
      </FormField>
      <FormField id="a-fac-tz" label="Timezone">
        <FormSelect id="a-fac-tz" options={TIMEZONE_OPTIONS} defaultValue={facility.timezone} />
      </FormField>
      <FormField id="a-fac-tier" label="Durability tier">
        <ASegmented
          id="a-fac-tier"
          legend="Durability tier"
          options={["200-year", "1000-year"]}
          initial={facility.durabilityTier}
        />
      </FormField>
      <ASaveRow />
    </div>
  );
}

export function ARegistryLinkPane({ facility, goTo }: APaneProps) {
  const save = useSaveStub();
  return (
    <div className="flex flex-col gap-24 content-measure-form" key={facility.id}>
      {facility.registryFacility ? (
        <FormField id="a-fcl" label="Isometric facility">
          <FormInput id="a-fcl" defaultValue={facility.registryFacility} />
        </FormField>
      ) : (
        <AReadRow
          label="Isometric facility"
          value="Not set"
          action={
            <Button variant="primary" onClick={save}>
              Link Isometric facility
            </Button>
          }
        />
      )}
      <AReadRow label="Soil temperature" value={facility.soilTemperature} />
      <Notice
        tone="info"
        action={
          <button type="button" className="body-small underline" onClick={() => goTo("registry")}>
            Open Organization, Registry
          </button>
        }
      >
        Project, protocol and Removal template are set once for the organization.
      </Notice>
      {facility.registryFacility && <ASaveRow />}
    </div>
  );
}

export function AEmissionsPane({ facility }: APaneProps) {
  const save = useSaveStub();
  if (facility.durabilityTier === "1000-year") {
    return (
      <EmptyState
        padding="md"
        icon={<CloudIcon size={40} />}
        title="Not used on the 1000-year tier"
        description={`${facility.name} certifies on the 1000-year tier, so it needs no emission estimates.`}
      />
    );
  }
  return (
    <ul className="flex flex-col border-t border-[var(--clr-dark-purple-10)]">
      {["Grid electricity by process stage", "Staff travel"].map((name) => (
        <li key={name} className="flex items-center justify-between gap-12 border-b border-[var(--clr-dark-purple-10)] py-12">
          <span className="body-medium">{name}</span>
          <Button onClick={save}>Edit</Button>
        </li>
      ))}
    </ul>
  );
}

/* Platform ------------------------------------------------------------------------------------- */

export function AOrganizationsPane({ active, openOrg }: APaneProps) {
  const save = useSaveStub();
  return (
    <div className="flex flex-col gap-24">
      <div className="flex">
        <Button variant="primary" onClick={save}>
          <PlusIcon size={16} weight="bold" aria-hidden />
          Create organization
        </Button>
      </div>
      <ul className="flex flex-col border-t border-[var(--clr-dark-purple-10)]">
        {fixtures.organizations.map((org) => {
          const current = org.id === active.id;
          return (
            <li
              key={org.id}
              className="flex flex-col gap-8 border-b border-[var(--clr-dark-purple-10)] py-12 md:flex-row md:items-center md:gap-16"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <span className="body-medium flex items-center gap-8">
                  {org.name}
                  {current && (
                    <span className="body-caption border border-[var(--st-wait-border)] bg-[var(--st-wait-bg)] px-6 text-[var(--st-wait)]">
                      You are here
                    </span>
                  )}
                </span>
                <span className="body-small text-[var(--color-text-secondary)]">
                  {org.members} members, Isometric keys {org.keysSaved ? "saved" : "not saved"}, last opened {org.lastOpened}
                </span>
              </div>
              <label className="body-small flex min-h-44 items-center gap-8">
                <input type="checkbox" defaultChecked={org.apiAccess} onChange={save} className="size-16" />
                API access
              </label>
              {current ? (
                <span className="body-small min-w-[88px] text-[var(--color-text-tertiary)]">Open now</span>
              ) : (
                <Button onClick={() => openOrg(org.id)} className="min-w-[88px]">
                  Open
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ADiagnosticsPane() {
  return (
    <div className="flex flex-col gap-16 content-measure-form">
      <AReadRow label="Last Isometric sync" value={fixtures.diagnostics.lastSync} />
      <AReadRow label="Failed submissions" value={String(fixtures.diagnostics.failedSubmissions)} />
      <AReadRow label="Template mapping" value="Read only" />
    </div>
  );
}
