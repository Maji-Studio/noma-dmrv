"use client";

/**
 * Throwaway: the Platform workspace of settings prototype variant E. A Platform
 * Admin lands here at sign-in. It has its own navigation: Organizations,
 * Create organization, Diagnostics, Template mapping.
 */
import { useState } from "react";
import {
  BuildingsIcon,
  CheckCircleIcon,
  PlusIcon,
  PulseIcon,
  TreeStructureIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { Button, Input, PageHeader, RowActionsMenu } from "@/components/ui";
import { FormField, FormSelect } from "@/components/forms";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { NOTHING_SAVED, variantEFixtures, type VariantEOrg } from "./variant-e-fixtures";

type PlatformPane = "organizations" | "create" | "diagnostics" | "mapping";

const NAV: { key: PlatformPane; label: string; icon: Icon }[] = [
  { key: "organizations", label: "Organizations", icon: BuildingsIcon },
  { key: "create", label: "Create organization", icon: PlusIcon },
  { key: "diagnostics", label: "Diagnostics", icon: PulseIcon },
  { key: "mapping", label: "Template mapping", icon: TreeStructureIcon },
];

interface VariantEPlatformProps {
  orgs: VariantEOrg[];
  onOpen: (orgId: string) => void;
  onToggleApiAccess: (orgId: string) => void;
}

export function VariantEPlatform({ orgs, onOpen, onToggleApiAccess }: VariantEPlatformProps) {
  const [pane, setPane] = useState<PlatformPane>("organizations");

  return (
    <div className="flex flex-col md:flex-row md:min-h-[calc(100vh-160px)]">
      <nav
        aria-label="Platform"
        className="shrink-0 bg-[var(--ink)] text-white md:w-[232px]"
      >
        <div className="flex flex-col gap-2 px-16 pb-8 pt-16 md:pb-16">
          <span className="body-medium font-medium">Platform</span>
          <span className="body-caption text-[var(--color-white-50)]">
            {variantEFixtures.platformAdmin.name}, Platform Admin
          </span>
        </div>
        <ul className="flex gap-2 overflow-x-auto px-8 pb-8 md:flex-col md:px-6 md:pb-16">
          {NAV.map((item) => {
            const ItemIcon = item.icon;
            const selected = item.key === pane;
            return (
              <li key={item.key} className="shrink-0">
                <button
                  type="button"
                  onClick={() => setPane(item.key)}
                  aria-current={selected ? "page" : undefined}
                  className={cn(
                    "flex min-h-44 w-full items-center gap-10 whitespace-nowrap border-l-[2px] px-12 text-left transition-colors md:min-h-40",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--clr-rose)]",
                    selected
                      ? "border-[var(--clr-rose)] bg-[var(--color-white-10)] text-white"
                      : "border-transparent text-[var(--color-white-75)] hover:bg-[var(--color-white-10)] hover:text-white",
                  )}
                >
                  <ItemIcon size={16} weight="bold" aria-hidden className="shrink-0" />
                  <span className="body-small">{item.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="min-w-0 flex-1">
        <div className="container-max page-shell">
          {pane === "organizations" && (
            <OrganizationsPane
              orgs={orgs}
              onOpen={onOpen}
              onToggleApiAccess={onToggleApiAccess}
              onCreate={() => setPane("create")}
            />
          )}
          {pane === "create" && <CreatePane />}
          {pane === "diagnostics" && <DiagnosticsPane />}
          {pane === "mapping" && <MappingPane orgs={orgs} />}
        </div>
      </div>
    </div>
  );
}

function OrganizationsPane({
  orgs,
  onOpen,
  onToggleApiAccess,
  onCreate,
}: {
  orgs: VariantEOrg[];
  onOpen: (orgId: string) => void;
  onToggleApiAccess: (orgId: string) => void;
  onCreate: () => void;
}) {
  const toast = useToast();
  const actionsFor = (org: VariantEOrg) => [
    {
      label: org.apiAccess ? "Turn API access off" : "Turn API access on",
      onSelect: () => {
        onToggleApiAccess(org.id);
        toast.info(NOTHING_SAVED);
      },
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="Organizations"
        actions={
          <Button variant="primary" onClick={onCreate}>
            <PlusIcon size={20} weight="bold" aria-hidden />
            New organization
          </Button>
        }
      />

      {/* Desktop: table. Phone: one card per organization. */}
      <div className="hidden border-[1.5px] border-[var(--clr-dark-purple-40)] bg-[var(--paper)] md:block">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-[var(--sea)] text-left">
              {["Name", "Members", "API access", "Isometric keys", "Last opened", ""].map((head, index) => (
                <th
                  key={head || `actions-${index}`}
                  scope="col"
                  className="body-small font-medium px-16 py-10 text-[var(--color-text-secondary)]"
                >
                  {head || <span className="sr-only">Actions</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orgs.map((org) => (
              <tr
                key={org.id}
                onClick={() => onOpen(org.id)}
                className="cursor-pointer border-t border-[var(--clr-dark-purple-10)] hover:bg-[var(--sea)]"
              >
                <td className="body-small font-medium px-16 py-10">{org.name}</td>
                <td className="body-small px-16 py-10">{org.members}</td>
                <td className="body-small px-16 py-10">{org.apiAccess ? "On" : "Off"}</td>
                <td className="body-small px-16 py-10">
                  <KeysState saved={org.keysSaved} />
                </td>
                <td className="body-small px-16 py-10 text-[var(--color-text-secondary)]">
                  {org.lastOpened ?? "Never"}
                </td>
                <td className="px-16 py-6">
                  <div className="flex items-center justify-end gap-4">
                    <Button
                      size="small"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpen(org.id);
                      }}
                    >
                      Open
                    </Button>
                    <RowActionsMenu label={`Actions for ${org.name}`} actions={actionsFor(org)} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="flex flex-col gap-12 md:hidden">
        {orgs.map((org) => (
          <li
            key={org.id}
            className="flex flex-col gap-12 border-[1.5px] border-[var(--clr-dark-purple-40)] bg-[var(--paper)] p-16"
          >
            <div className="flex items-start justify-between gap-8">
              <span className="body-medium font-medium">{org.name}</span>
              <RowActionsMenu label={`Actions for ${org.name}`} actions={actionsFor(org)} />
            </div>
            <dl className="grid grid-cols-2 gap-x-12 gap-y-6 body-small">
              <dt className="text-[var(--color-text-secondary)]">Members</dt>
              <dd>{org.members}</dd>
              <dt className="text-[var(--color-text-secondary)]">API access</dt>
              <dd>{org.apiAccess ? "On" : "Off"}</dd>
              <dt className="text-[var(--color-text-secondary)]">Isometric keys</dt>
              <dd>
                <KeysState saved={org.keysSaved} />
              </dd>
              <dt className="text-[var(--color-text-secondary)]">Last opened</dt>
              <dd>{org.lastOpened ?? "Never"}</dd>
            </dl>
            <Button width="full" onClick={() => onOpen(org.id)}>
              Open
            </Button>
          </li>
        ))}
      </ul>
    </>
  );
}

function KeysState({ saved }: { saved: boolean }) {
  return saved ? (
    <span className="inline-flex items-center gap-6">
      <CheckCircleIcon size={16} weight="fill" aria-hidden className="text-[var(--st-ok)]" />
      Saved
    </span>
  ) : (
    <span className="inline-flex items-center gap-6 text-[var(--st-wait)]">
      <WarningIcon size={16} weight="fill" aria-hidden />
      Not saved
    </span>
  );
}

function CreatePane() {
  const toast = useToast();
  return (
    <>
      <PageHeader eyebrow="Platform" title="Create organization" />
      <div className="content-measure-form flex flex-col gap-16 border-[1.5px] border-[var(--clr-dark-purple-40)] bg-[var(--paper)] p-24">
        <FormField id="variant-e-create-name" label="Name">
          <Input id="variant-e-create-name" placeholder="Mafinga Biochar" />
        </FormField>
        <FormField id="variant-e-create-slug" label="Slug" cue="Lowercase letters, numbers and dashes.">
          <Input id="variant-e-create-slug" placeholder="mafinga-biochar" />
        </FormField>
        <FormField id="variant-e-create-owner" label="Owner email" cue="The owner needs a noma account first.">
          <Input id="variant-e-create-owner" type="email" placeholder="owner@example.com" />
        </FormField>
        <div>
          <Button variant="primary" onClick={() => toast.info(NOTHING_SAVED)}>
            Create organization
          </Button>
        </div>
      </div>
    </>
  );
}

function DiagnosticsPane() {
  return (
    <>
      <PageHeader eyebrow="Platform" title="Diagnostics" />
      <ul className="flex flex-col border-[1.5px] border-[var(--clr-dark-purple-40)] bg-[var(--paper)]">
        {variantEFixtures.diagnostics.map((row) => (
          <li
            key={row.check}
            className="flex min-h-56 items-center gap-12 border-b border-[var(--clr-dark-purple-10)] px-16 py-10 last:border-b-0"
          >
            {row.ok ? (
              <CheckCircleIcon size={20} weight="fill" aria-label="Passing" className="shrink-0 text-[var(--st-ok)]" />
            ) : (
              <WarningIcon size={20} weight="fill" aria-label="Needs attention" className="shrink-0 text-[var(--st-wait)]" />
            )}
            <span className="body-small font-medium min-w-0 flex-1">{row.check}</span>
            <span className="body-small shrink-0 text-[var(--color-text-secondary)]">{row.detail}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function MappingPane({ orgs }: { orgs: VariantEOrg[] }) {
  const facilities = orgs.flatMap((org) =>
    org.facilities.map((facility) => ({ value: `${org.id}:${facility.name}`, label: `${org.name}, ${facility.name}` })),
  );
  return (
    <>
      <PageHeader eyebrow="Platform" title="Template mapping" />
      <div className="max-w-[360px]">
        <FormField id="variant-e-mapping-facility" label="Facility">
          <FormSelect id="variant-e-mapping-facility" options={facilities} defaultValue={facilities[0]?.value} />
        </FormField>
      </div>
      <div className="border-[1.5px] border-[var(--clr-dark-purple-40)] bg-[var(--paper)]">
        <p className="body-small font-medium border-b border-[var(--clr-dark-purple-10)] bg-[var(--sea)] px-16 py-10 text-[var(--color-text-secondary)]">
          Biochar Removal 2026
        </p>
        <ul className="flex flex-col">
          {variantEFixtures.templateMapping.map((row) => (
            <li
              key={row.component}
              className="flex flex-col gap-2 border-b border-[var(--clr-dark-purple-10)] px-16 py-10 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-12"
            >
              <span className="body-small min-w-0">{row.component}</span>
              <span
                className={cn(
                  "body-small shrink-0",
                  row.decided ? "text-[var(--color-text-secondary)]" : "text-[var(--st-wait)]",
                )}
              >
                {row.source}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
