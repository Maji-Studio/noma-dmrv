"use client";

/**
 * Throwaway: the minimal settings inside an organization for settings
 * prototype variant E. Two groups in one tab row: Organization (General,
 * Members, Registry, Developers) and You (Profile, Connected apps).
 */
import { useState, type ReactNode } from "react";
import { Button, Input, Notice, PageHeader } from "@/components/ui";
import { FormField, FormSelect, SegmentedControl } from "@/components/forms";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { NOTHING_SAVED, variantEFixtures, type VariantEOrg } from "./variant-e-fixtures";

type OrgPane = "general" | "members" | "registry" | "developers" | "profile" | "apps";

const TAB_GROUPS: { label: string; tabs: { key: OrgPane; label: string }[] }[] = [
  {
    label: "Organization",
    tabs: [
      { key: "general", label: "General" },
      { key: "members", label: "Members" },
      { key: "registry", label: "Registry" },
      { key: "developers", label: "Developers" },
    ],
  },
  {
    label: "You",
    tabs: [
      { key: "profile", label: "Profile" },
      { key: "apps", label: "Connected apps" },
    ],
  },
];

const PANE_TITLE: Record<OrgPane, string> = {
  general: "General",
  members: "Members",
  registry: "Registry",
  developers: "Developers",
  profile: "Profile",
  apps: "Connected apps",
};

interface VariantEOrgSettingsProps {
  org: VariantEOrg;
  /** True when a Platform Admin opened the org from the Platform workspace. */
  asPlatformAdmin: boolean;
  onToggleApiAccess: () => void;
}

export function VariantEOrgSettings({ org, asPlatformAdmin, onToggleApiAccess }: VariantEOrgSettingsProps) {
  const [pane, setPane] = useState<OrgPane>("general");
  const role = asPlatformAdmin ? "Platform Admin" : "Owner";

  return (
    <div className="container-max page-shell">
      <PageHeader
        eyebrow={org.name}
        title="Settings"
        actions={
          <span
            className={cn(
              "body-small inline-flex items-center rounded-full px-12 py-4 font-medium",
              asPlatformAdmin
                ? "bg-[var(--acc-infra-ink)] text-white"
                : "bg-[var(--clr-dark-purple-5)] text-[var(--color-text-secondary)]",
            )}
          >
            {role}
          </span>
        }
      />

      <div
        role="tablist"
        aria-label="Settings sections"
        className="flex gap-24 overflow-x-auto border-b border-[var(--clr-dark-purple-20)]"
      >
        {TAB_GROUPS.map((group) => (
          <div key={group.label} className="flex shrink-0 flex-col gap-4">
            <span className="body-caption text-[var(--color-text-tertiary)]">{group.label}</span>
            <div className="flex">
              {group.tabs.map((tab) => {
                const selected = tab.key === pane;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setPane(tab.key)}
                    className={cn(
                      "body-small min-h-44 whitespace-nowrap border-b-[2px] px-12 transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-interaction)]",
                      selected
                        ? "border-[var(--clr-dark-purple)] font-medium text-[var(--color-text-primary)]"
                        : "border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
                    )}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div role="tabpanel" aria-label={PANE_TITLE[pane]} className="content-measure-preview flex flex-col gap-24">
        {pane === "general" && <GeneralPane org={org} />}
        {pane === "members" && <MembersPane />}
        {pane === "registry" && <RegistryPane org={org} />}
        {pane === "developers" && (
          <DevelopersPane org={org} asPlatformAdmin={asPlatformAdmin} onToggleApiAccess={onToggleApiAccess} />
        )}
        {pane === "profile" && <ProfilePane asPlatformAdmin={asPlatformAdmin} />}
        {pane === "apps" && <AppsPane org={org} asPlatformAdmin={asPlatformAdmin} />}
      </div>
    </div>
  );
}

function Panel({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <section
      aria-label={title}
      className="border-[1.5px] border-[var(--clr-dark-purple-40)] bg-[var(--paper)]"
    >
      <h2 className="body-small font-medium border-b border-[var(--clr-dark-purple-10)] bg-[var(--sea)] px-16 py-10 text-[var(--color-text-secondary)]">
        {title}
      </h2>
      <div className="flex flex-col gap-16 p-16 md:p-24">{children}</div>
      {footer && <div className="border-t border-[var(--clr-dark-purple-10)] px-16 py-12 md:px-24">{footer}</div>}
    </section>
  );
}

function SaveButton({ label = "Save" }: { label?: string }) {
  const toast = useToast();
  return (
    <Button variant="primary" onClick={() => toast.info(NOTHING_SAVED)}>
      {label}
    </Button>
  );
}

function LocalSegmented({ id, legend, options, initial }: { id: string; legend: string; options: string[]; initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <SegmentedControl
      id={id}
      legend={legend}
      value={value}
      onValueChange={setValue}
      options={options.map((option) => ({ value: option, label: option }))}
    />
  );
}

function GeneralPane({ org }: { org: VariantEOrg }) {
  return (
    <Panel title="Organization" footer={<SaveButton />}>
      <FormField id="variant-e-org-name" label="Organization name">
        <Input id="variant-e-org-name" defaultValue={org.name} />
      </FormField>
      <div className="grid gap-16 md:grid-cols-2">
        <FormField id="variant-e-country" label="Default country">
          <FormSelect
            id="variant-e-country"
            defaultValue="Tanzania"
            options={["Tanzania", "Kenya", "Uganda"].map((value) => ({ value, label: value }))}
          />
        </FormField>
        <FormField id="variant-e-timezone" label="Default timezone">
          <FormSelect
            id="variant-e-timezone"
            defaultValue="Africa/Dar_es_Salaam"
            options={["Africa/Dar_es_Salaam", "Africa/Nairobi", "UTC"].map((value) => ({ value, label: value }))}
          />
        </FormField>
      </div>
      <FormField id="variant-e-evidence" label="Application evidence" cue="Seeds new applications.">
        <LocalSegmented
          id="variant-e-evidence"
          legend="Application evidence"
          options={["Customer location", "GIS reference", "Visual evidence"]}
          initial="Customer location"
        />
      </FormField>
      <FormField id="variant-e-packaging" label="Order packaging" cue="Seeds new orders.">
        <LocalSegmented id="variant-e-packaging" legend="Order packaging" options={["Loose", "Bagged"]} initial="Bagged" />
      </FormField>
    </Panel>
  );
}

function MembersPane() {
  const toast = useToast();
  return (
    <>
      <Panel title="Members">
        <ul className="flex flex-col">
          {variantEFixtures.members.map((member) => (
            <li
              key={member.name}
              className="flex min-h-44 items-center gap-12 border-b border-[var(--clr-dark-purple-10)] py-6 last:border-b-0"
            >
              <span className="body-small min-w-0 flex-1 truncate">{member.name}</span>
              <span className="body-caption hidden shrink-0 text-[var(--color-text-tertiary)] sm:inline">
                {member.lastActive}
              </span>
              {member.role === "Owner" ? (
                <span className="body-small w-[120px] shrink-0 px-12 text-[var(--color-text-secondary)]">Owner</span>
              ) : (
                <FormSelect
                  aria-label={`Role of ${member.name}`}
                  defaultValue={member.role}
                  className="w-[120px] shrink-0"
                  onChange={() => toast.info(NOTHING_SAVED)}
                  options={["Admin", "Member"].map((value) => ({ value, label: value }))}
                />
              )}
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Invite">
        <div className="flex flex-col gap-12 sm:flex-row sm:items-end">
          <div className="flex-1">
            <FormField id="variant-e-invite" label="Email">
              <Input id="variant-e-invite" type="email" placeholder="name@example.com" />
            </FormField>
          </div>
          <Button onClick={() => toast.info(NOTHING_SAVED)}>Send invitation</Button>
        </div>
      </Panel>
    </>
  );
}

function RegistryPane({ org }: { org: VariantEOrg }) {
  return (
    <>
      <Panel title="Isometric account" footer={<SaveButton label="Save keys" />}>
        {!org.keysSaved && <Notice tone="warning">No keys saved. Removals cannot be sent until they are.</Notice>}
        <div className="grid gap-16 md:grid-cols-2">
          <FormField id="variant-e-client-id" label="Client ID">
            <Input id="variant-e-client-id" autoComplete="off" placeholder={org.keysSaved ? "Saved" : undefined} />
          </FormField>
          <FormField id="variant-e-client-secret" label="Client secret">
            <Input id="variant-e-client-secret" type="password" autoComplete="off" />
          </FormField>
        </div>
      </Panel>
      <Panel title="Project" footer={<SaveButton />}>
        <FormField id="variant-e-project" label="Isometric project">
          <FormSelect
            id="variant-e-project"
            options={[
              { value: "prj_1K9YJ33R", label: `prj_1K9YJ33R, ${org.name}` },
              { value: "prj_2B7QX0LM", label: `prj_2B7QX0LM, ${org.name} pilot` },
            ]}
          />
        </FormField>
        <div className="grid gap-16 md:grid-cols-2">
          <FormField id="variant-e-protocol" label="Protocol">
            <FormSelect
              id="variant-e-protocol"
              options={["Biochar v1.1", "Biochar v1.0"].map((value) => ({ value, label: value }))}
            />
          </FormField>
          <FormField
            id="variant-e-template"
            label="Default Removal template"
            warning="3 components to decide"
          >
            <FormSelect
              id="variant-e-template"
              options={["Biochar Removal 2026", "Biochar Removal 2025"].map((value) => ({ value, label: value }))}
            />
          </FormField>
        </div>
        <FormField id="variant-e-sources" label="New Sources">
          <LocalSegmented
            id="variant-e-sources"
            legend="New Sources"
            options={["Private: verifier only", "Public on the registry"]}
            initial="Private: verifier only"
          />
        </FormField>
      </Panel>
      <Panel title="Facilities" footer={<SaveButton />}>
        {org.facilities.map((facility) => {
          const id = `variant-e-fcl-${facility.name}`;
          return (
            <FormField key={facility.name} id={id} label={`${facility.name}: registry facility ID`}>
              <Input id={id} defaultValue={facility.registryFacilityId ?? ""} placeholder="fcl_" />
            </FormField>
          );
        })}
      </Panel>
    </>
  );
}

function DevelopersPane({
  org,
  asPlatformAdmin,
  onToggleApiAccess,
}: {
  org: VariantEOrg;
  asPlatformAdmin: boolean;
  onToggleApiAccess: () => void;
}) {
  const toast = useToast();
  return (
    <>
      <Panel title="API access">
        {asPlatformAdmin ? (
          <SegmentedControl
            legend="API access"
            value={org.apiAccess ? "on" : "off"}
            onValueChange={() => {
              onToggleApiAccess();
              toast.info(NOTHING_SAVED);
            }}
            options={[
              { value: "on", label: "On" },
              { value: "off", label: "Off" },
            ]}
            className="max-w-[240px]"
          />
        ) : (
          <p className="body-small">
            {org.apiAccess ? "On" : "Off"}
            <span className="text-[var(--color-text-tertiary)]">. Platform Admins turn it on or off.</span>
          </p>
        )}
      </Panel>
      <Panel title="API keys">
        {asPlatformAdmin ? (
          <Notice tone="info">API keys belong to members. Owners and Admins of {org.name} create them.</Notice>
        ) : !org.apiAccess ? (
          <Notice tone="info">API access is off for {org.name}.</Notice>
        ) : (
          <>
            <ul className="flex flex-col">
              {variantEFixtures.apiKeys.map((key) => (
                <li
                  key={key}
                  className="flex min-h-44 items-center justify-between gap-12 border-b border-[var(--clr-dark-purple-10)] py-6 last:border-b-0"
                >
                  <span className="body-small">{key}</span>
                  <Button size="small" variant="destructive" onClick={() => toast.info(NOTHING_SAVED)}>
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
            <div>
              <Button onClick={() => toast.info(NOTHING_SAVED)}>Create API key</Button>
            </div>
          </>
        )}
      </Panel>
    </>
  );
}

function ProfilePane({ asPlatformAdmin }: { asPlatformAdmin: boolean }) {
  const person = asPlatformAdmin ? variantEFixtures.platformAdmin : variantEFixtures.owner;
  return (
    <Panel title="Profile" footer={<SaveButton />}>
      <FormField id="variant-e-profile-name" label="Name">
        <Input id="variant-e-profile-name" defaultValue={person.name} />
      </FormField>
      <FormField id="variant-e-profile-email" label="Email" cue="The same in every organization.">
        <Input id="variant-e-profile-email" type="email" defaultValue={person.email} />
      </FormField>
      <FormField id="variant-e-profile-password" label="New password" cue="At least 12 characters.">
        <Input id="variant-e-profile-password" type="password" autoComplete="new-password" />
      </FormField>
    </Panel>
  );
}

function AppsPane({ org, asPlatformAdmin }: { org: VariantEOrg; asPlatformAdmin: boolean }) {
  const toast = useToast();
  return (
    <Panel title="Connected apps">
      {asPlatformAdmin ? (
        <Notice tone="info">Connected apps belong to members of {org.name}.</Notice>
      ) : (
        <ul className="flex flex-col">
          <li className="flex min-h-44 items-center justify-between gap-12 py-6">
            <div className="flex min-w-0 flex-col">
              <span className="body-small">Claude</span>
              <span className="body-caption text-[var(--color-text-tertiary)]">Connected 2 Oct</span>
            </div>
            <Button size="small" onClick={() => toast.info(NOTHING_SAVED)}>
              Disconnect
            </Button>
          </li>
        </ul>
      )}
    </Panel>
  );
}
