"use client";

/**
 * Throwaway: pane bodies for prototype variant A (one console by scope).
 * The registry panes live in `variant-a-registry-panes.tsx`. Every save is a
 * stub toast.
 */
import {
  DotsThreeVerticalIcon,
  PlusIcon,
} from "@phosphor-icons/react/dist/ssr";
import { Button, DropdownMenu, Notice } from "@/components/ui";
import {
  FormField,
  FormInput,
  FormSelect,
} from "@/components/forms";
import { fixtures } from "./abd-fixtures";
import {
  AReadRow,
  ASaveRow,
  ASection,
  ASegmented,
  ATextAction,
  useSaveStub,
  type APaneProps,
} from "./variant-a-parts";

export type { APaneProps } from "./variant-a-parts";

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

export function ADevelopersPane({ active, goTo }: APaneProps) {
  const save = useSaveStub();
  return (
    <div className="flex flex-col gap-24">
      <AReadRow
        label="API access"
        value="On"
        action={
          active.isPlatformAdminInside ? (
            <ATextAction onClick={() => goTo("organizations")}>Change in Platform, Organizations</ATextAction>
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
      <ASaveRow />
    </div>
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

const CONNECTION_LABEL: Record<APaneProps["registry"], string> = {
  none: "No registry",
  "keys-missing": "Keys not saved",
  connected: "Connected",
  failing: "Connection failing",
};

export function ADiagnosticsPane({ active, registry }: APaneProps) {
  return (
    <div className="flex flex-col gap-16 content-measure-form">
      <AReadRow label={`Isometric connection of ${active.name}`} value={CONNECTION_LABEL[registry]} />
      <AReadRow
        label="Last Isometric sync"
        value={registry === "connected" ? fixtures.diagnostics.lastSync : fixtures.registry.lastGoodCheck}
      />
      <AReadRow label="Failed submissions" value={String(fixtures.diagnostics.failedSubmissions)} />
    </div>
  );
}
