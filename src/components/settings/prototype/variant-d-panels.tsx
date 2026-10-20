"use client";

/**
 * Throwaway: the Organization tabs, the Facility page and the Platform page of
 * prototype variant D (facility first). Every save is a stub toast.
 */
import { useState, type ReactNode } from "react";
import { CheckCircleIcon, CloudIcon, PlusIcon } from "@phosphor-icons/react/dist/ssr";
import { Button, EmptyState, Notice } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { FormField, FormInput, FormSelect, SegmentedControl } from "@/components/forms";
import { fixtures, PROTOTYPE_SAVE_TOAST, type PrototypeFacility } from "./abd-fixtures";
import type { PrototypeActiveOrg } from "./abd-active-org";

function useSave() {
  const toast = useToast();
  return () => toast.info(PROTOTYPE_SAVE_TOAST);
}

/** One settings row: what and who on the left, the controls on the right. */
function DRow({ title, who, children }: { title: string; who: string; children: ReactNode }) {
  return (
    <div className="grid gap-12 border-b border-[var(--clr-dark-purple-10)] px-16 py-20 last:border-b-0 sm:px-24 md:grid-cols-[220px_minmax(0,1fr)] md:gap-32">
      <div className="flex flex-col gap-4">
        <h3 className="body-medium font-medium">{title}</h3>
        <span className="body-caption text-[var(--color-text-tertiary)]">{who}</span>
      </div>
      <div className="flex min-w-0 max-w-[560px] flex-col gap-16">{children}</div>
    </div>
  );
}

function DFrame({ children }: { children: ReactNode }) {
  return <div className="border-[1.5px] border-[var(--clr-dark-purple-40)] bg-[var(--paper)]">{children}</div>;
}

function DValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="body-small text-[var(--color-text-secondary)]">{label}</span>
      <span className="body-medium break-words">{children}</span>
    </div>
  );
}

function DSegmented({ id, legend, options, initial }: { id: string; legend: string; options: readonly string[]; initial: string }) {
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

/* Organization side ---------------------------------------------------------------------------- */

export const D_ORG_TABS = [
  { key: "members", label: "Members" },
  { key: "registry", label: "Registry account" },
  { key: "defaults", label: "Defaults" },
  { key: "developers", label: "Developer access" },
] as const;
export type DOrgTab = (typeof D_ORG_TABS)[number]["key"];

export function DOrgTabPanel({ tab, active }: { tab: DOrgTab; active: PrototypeActiveOrg }) {
  const save = useSave();
  const who = active.canManage ? "Owners and Admins change this" : "Owners and Admins change this. You can view it.";
  const reg = fixtures.registry;

  if (tab === "members") {
    return (
      <DFrame>
        <DRow title="Members" who="Everyone sees this list">
          <ul className="flex flex-col">
            {fixtures.members.map((m) => (
              <li key={m.id} className="flex items-center gap-12 py-8">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="body-medium truncate">{m.name}</span>
                  <span className="body-small truncate text-[var(--color-text-secondary)]">{m.email}</span>
                </span>
                <span className="body-small">{m.role}</span>
              </li>
            ))}
          </ul>
          {active.canManage && (
            <div className="flex">
              <Button variant="primary" onClick={save}>
                <PlusIcon size={16} weight="bold" aria-hidden />
                Invite member
              </Button>
            </div>
          )}
        </DRow>
        <DRow title="Invitations" who={who}>
          {fixtures.invitations.map((invite) => (
            <div key={invite.id} className="flex items-center justify-between gap-12">
              <span className="flex flex-col">
                <span className="body-medium">{invite.email}</span>
                <span className="body-small text-[var(--color-text-secondary)]">Sent {invite.sent}</span>
              </span>
              {active.canManage && (
                <Button size="small" onClick={save}>
                  Revoke
                </Button>
              )}
            </div>
          ))}
        </DRow>
      </DFrame>
    );
  }

  if (tab === "registry") {
    return (
      <DFrame>
        <DRow title="Isometric account" who={who}>
          <DValue label="Registry">
            {reg.name} ({reg.environment})
          </DValue>
          <DValue label="Isometric keys">
            <span className="inline-flex items-center gap-6">
              <CheckCircleIcon size={16} weight="fill" className="text-[var(--st-ok)]" aria-hidden />
              Saved, {reg.keyHint}
            </span>
          </DValue>
          {active.canManage && (
            <div className="flex">
              <Button onClick={save}>Replace keys</Button>
            </div>
          )}
        </DRow>
        <DRow title="Project" who={who}>
          <FormField id="d-project" label="Isometric project">
            <FormInput id="d-project" defaultValue={reg.project} />
          </FormField>
          <DValue label="Protocol">{reg.protocol}</DValue>
          <FormField id="d-template" label="Default Removal template">
            <FormSelect
              id="d-template"
              options={[{ value: reg.defaultRemovalTemplate, label: reg.defaultRemovalTemplate }]}
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
        </DRow>
        <DRow title="Sources" who={who}>
          <FormField id="d-sources" label="Source visibility">
            <FormSelect
              id="d-sources"
              options={[
                { value: "private", label: "Private: verifier only" },
                { value: "public", label: "Public on the registry" },
              ]}
              defaultValue="private"
            />
          </FormField>
          {active.canManage && (
            <div className="flex">
              <Button variant="primary" onClick={save}>
                Save registry account
              </Button>
            </div>
          )}
        </DRow>
      </DFrame>
    );
  }

  if (tab === "defaults") {
    return (
      <DFrame>
        <DRow title="Organization" who={who}>
          <FormField id="d-org-name" label="Name">
            <FormInput id="d-org-name" defaultValue={active.name} key={active.id} />
          </FormField>
        </DRow>
        <DRow title="New facilities" who={who}>
          <FormField id="d-country" label="Country">
            <FormSelect id="d-country" options={[{ value: "Tanzania", label: "Tanzania" }, { value: "Kenya", label: "Kenya" }]} defaultValue="Tanzania" />
          </FormField>
          <FormField id="d-tz" label="Timezone">
            <FormSelect id="d-tz" options={[{ value: "Africa/Dar_es_Salaam", label: "Africa/Dar es Salaam (EAT, UTC+3)" }]} defaultValue="Africa/Dar_es_Salaam" />
          </FormField>
        </DRow>
        <DRow title="New records" who={who}>
          <FormField id="d-evidence" label="Application evidence">
            <DSegmented id="d-evidence" legend="Application evidence" options={["Customer location", "GIS reference"]} initial={fixtures.orgDefaults.evidenceMethod} />
          </FormField>
          <FormField id="d-packaging" label="Order packaging">
            <DSegmented id="d-packaging" legend="Order packaging" options={["Loose", "Bagged"]} initial={fixtures.orgDefaults.packaging} />
          </FormField>
          {active.canManage && (
            <div className="flex">
              <Button variant="primary" onClick={save}>
                Save defaults
              </Button>
            </div>
          )}
        </DRow>
      </DFrame>
    );
  }

  return (
    <DFrame>
      <DRow title="API access" who="A Platform Admin turns this on">
        <DValue label="Status">On</DValue>
      </DRow>
      <DRow title="API keys" who="Owners and Admins">
        {active.isPlatformAdminInside && (
          <Notice tone="info">Platform Admins cannot own API keys. A member of {active.name} creates them.</Notice>
        )}
        {fixtures.apiKeys.map((key) => (
          <div key={key.id} className="flex items-center justify-between gap-12">
            <span className="flex flex-col">
              <span className="body-medium">{key.name}</span>
              <span className="body-small text-[var(--color-text-secondary)]">
                {key.owner}, last used {key.lastUsed}
              </span>
            </span>
            <Button size="small" variant="destructive" onClick={save}>
              Revoke
            </Button>
          </div>
        ))}
        {!active.isPlatformAdminInside && (
          <div className="flex">
            <Button variant="primary" onClick={save}>
              <PlusIcon size={16} weight="bold" aria-hidden />
              Create API key
            </Button>
          </div>
        )}
      </DRow>
    </DFrame>
  );
}

/* Facility side -------------------------------------------------------------------------------- */

function DRemovalTemplate({ facility }: { facility: PrototypeFacility }) {
  const save = useSave();
  const orgTemplate = fixtures.registry.defaultRemovalTemplate;
  const [override, setOverride] = useState<string | null>(facility.removalTemplate);

  if (override === null) {
    return (
      <>
        <DValue label="Removal template">
          {orgTemplate}
          <span className="body-small block text-[var(--color-text-secondary)]">From organization</span>
        </DValue>
        <div className="flex">
          <Button onClick={() => setOverride(orgTemplate)}>Override for {facility.name}</Button>
        </div>
      </>
    );
  }
  return (
    <div className="flex flex-col gap-8 sm:flex-row sm:items-end">
      <div className="min-w-0 flex-1">
        <FormField id={`d-template-${facility.id}`} label="Removal template">
          <FormSelect
            id={`d-template-${facility.id}`}
            options={[
              { value: orgTemplate, label: orgTemplate },
              { value: "Biochar in agricultural soils (200-year)", label: "Biochar in agricultural soils (200-year)" },
            ]}
            value={override}
            onChange={(event) => {
              setOverride(event.target.value);
              save();
            }}
          />
        </FormField>
      </div>
      <Button
        onClick={() => {
          setOverride(null);
          save();
        }}
      >
        Reset to default
      </Button>
    </div>
  );
}

export function DFacilityPage({ facility, canManage }: { facility: PrototypeFacility; canManage: boolean }) {
  const save = useSave();
  const who = canManage ? "Owners and Admins change this" : "Owners and Admins change this. You can view it.";
  return (
    <DFrame key={facility.id}>
      <DRow title="Site" who={who}>
        <FormField id="d-fac-name" label="Name">
          <FormInput id="d-fac-name" defaultValue={facility.name} />
        </FormField>
        <FormField id="d-fac-country" label="Country">
          <FormSelect id="d-fac-country" options={[{ value: "Tanzania", label: "Tanzania" }]} defaultValue={facility.country} />
        </FormField>
        <FormField id="d-fac-tz" label="Timezone">
          <FormSelect id="d-fac-tz" options={[{ value: "Africa/Dar_es_Salaam", label: "Africa/Dar es Salaam (EAT, UTC+3)" }]} defaultValue={facility.timezone} />
        </FormField>
      </DRow>
      <DRow title="Durability tier" who={who}>
        <FormField id="d-fac-tier" label="Tier">
          <DSegmented id="d-fac-tier" legend="Durability tier" options={["200-year", "1000-year"]} initial={facility.durabilityTier} />
        </FormField>
      </DRow>
      <DRow title="Registry link" who={who}>
        {facility.registryFacility ? (
          <FormField id="d-fcl" label="Isometric facility">
            <FormInput id="d-fcl" defaultValue={facility.registryFacility} />
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
        <DValue label="Soil temperature">{facility.soilTemperature}</DValue>
      </DRow>
      <DRow title="Removal template" who={who}>
        <DRemovalTemplate facility={facility} />
      </DRow>
      <DRow title="Emissions" who={who}>
        {facility.durabilityTier === "1000-year" ? (
          <EmptyState
            padding="sm"
            icon={<CloudIcon size={32} />}
            title="Not used on the 1000-year tier"
            description={`${facility.name} needs no emission estimates.`}
          />
        ) : (
          <DValue label="Emission estimates">{facility.emissions}</DValue>
        )}
      </DRow>
      {canManage && (
        <div className="px-16 py-16 sm:px-24">
          <Button variant="primary" onClick={save}>
            Save {facility.name}
          </Button>
        </div>
      )}
    </DFrame>
  );
}

/* Platform side -------------------------------------------------------------------------------- */

export function DPlatformPage({ activeId, onOpen }: { activeId: string; onOpen: (orgId: string) => void }) {
  const save = useSave();
  return (
    <div className="flex flex-col gap-24">
      <div className="flex flex-wrap gap-12">
        <Button variant="primary" onClick={save}>
          <PlusIcon size={16} weight="bold" aria-hidden />
          Create organization
        </Button>
      </div>
      <div className="overflow-x-auto border-[1.5px] border-[var(--clr-dark-purple-40)] bg-[var(--paper)]">
        <table className="w-full min-w-[640px] border-collapse">
          <thead className="bg-[var(--sea)]">
            <tr className="body-small text-left font-medium text-[var(--color-text-secondary)]">
              <th className="px-16 py-10 font-medium">Organization</th>
              <th className="px-16 py-10 text-right font-medium">Members</th>
              <th className="px-16 py-10 font-medium">API access</th>
              <th className="px-16 py-10 font-medium">Isometric keys</th>
              <th className="px-16 py-10 font-medium">Last opened</th>
              <th className="px-16 py-10">
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {fixtures.organizations.map((org) => (
              <tr key={org.id} className="body-small border-t border-[var(--clr-dark-purple-10)]">
                <td className="px-16 py-10">{org.name}</td>
                <td className="px-16 py-10 text-right tabular-nums">{org.members}</td>
                <td className="px-16 py-10">
                  <label className="inline-flex min-h-44 items-center gap-8">
                    <input type="checkbox" defaultChecked={org.apiAccess} onChange={save} className="size-16" />
                    {org.apiAccess ? "On" : "Off"}
                  </label>
                </td>
                <td className="px-16 py-10">{org.keysSaved ? "Saved" : "Not saved"}</td>
                <td className="px-16 py-10">{org.lastOpened}</td>
                <td className="px-16 py-10 text-right">
                  {org.id === activeId ? (
                    <span className="text-[var(--color-text-tertiary)]">Open now</span>
                  ) : (
                    <Button size="small" onClick={() => onOpen(org.id)}>
                      Open
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <DFrame>
        <DRow title="Diagnostics" who="Platform Admins">
          <DValue label="Last Isometric sync">{fixtures.diagnostics.lastSync}</DValue>
          <DValue label="Failed submissions">{fixtures.diagnostics.failedSubmissions}</DValue>
        </DRow>
        <DRow title="Template mapping" who="Read only">
          <DValue label="Mapping">Read only</DValue>
        </DRow>
      </DFrame>
    </div>
  );
}
