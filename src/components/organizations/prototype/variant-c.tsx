/**
 * PROTOTYPE (#1373) Variant C, "Organization pages": master and detail. A
 * narrow searchable list on the left; the selected organization fills the
 * right with everything a Platform Admin does to it, keys edited inline
 * rather than in a dialog. "New organization" opens the same panel in create
 * mode. On a phone the list and the panel stack, with a back link.
 */
"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeftIcon, BuildingsIcon, MagnifyingGlassIcon, PlusIcon, WarningCircleIcon } from "@phosphor-icons/react/dist/ssr";
import { Button, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { OrganizationCertifierCredentials } from "../organization-certifier-credentials";
import {
  CreateOrganizationForm,
  filterRows,
  membersLabel,
  useApiAccessToggle,
  useKeysSaved,
  useOrgDirectory,
  type OrgRow,
} from "./shared";

const NEW = "new";

export function VariantC() {
  const dir = useOrgDirectory();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [query, setQuery] = useState("");
  const selectedKey = params.get("org");
  const selected = selectedKey && selectedKey !== NEW ? dir.rows.find((r) => r.id === selectedKey) ?? null : null;
  const creating = selectedKey === NEW;
  const rows = filterRows(dir.rows, query);
  const detailOpen = creating || !!selected;

  function select(key: string | null) {
    const q = new URLSearchParams(params.toString());
    if (key) q.set("org", key);
    else q.delete("org");
    router.replace(`${pathname}?${q.toString()}`);
  }

  return (
    <div className="container-max page-shell">
      <PageHeader eyebrow="Platform" title="Organizations" />
      <div className="grid grid-cols-1 gap-24 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className={`flex flex-col border-[1.5px] border-[var(--clr-dark-purple-40)] bg-[var(--paper)] ${detailOpen ? "hidden lg:flex" : "flex"}`}>
          <div className="flex items-center gap-8 border-b border-[var(--color-border-secondary)] px-12">
            <MagnifyingGlassIcon size={18} className="text-[var(--color-icon-secondary)]" />
            <input aria-label="Search organizations" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} className="body-medium h-44 w-full bg-transparent outline-none" />
          </div>
          <button type="button" onClick={() => select(NEW)} className={`body-small flex min-h-44 items-center gap-8 border-b border-[var(--color-border-secondary)] px-12 font-medium ${creating ? "bg-[var(--clr-dark-purple-5)]" : ""}`}>
            <PlusIcon size={16} weight="bold" /> New organization
          </button>
          {dir.isLoading ? (
            <div className="p-12"><Skeleton className="h-64 w-full" /></div>
          ) : (
            <ul className="flex flex-col">
              {rows.map((row) => (
                <ListItemC key={row.id} row={row} active={row.id === selected?.id} onSelect={() => select(row.id)} />
              ))}
            </ul>
          )}
        </aside>

        <section className={`${detailOpen ? "flex" : "hidden lg:flex"} min-w-0 flex-col`}>
          {detailOpen && (
            <button type="button" onClick={() => select(null)} className="body-small mb-12 flex min-h-44 items-center gap-6 lg:hidden">
              <ArrowLeftIcon size={16} /> All organizations
            </button>
          )}
          {creating ? (
            <div className="flex flex-col gap-20 border-[1.5px] border-[var(--clr-dark-purple-40)] bg-[var(--paper)] p-24">
              <h2 className="title-heading-3">New organization</h2>
              <div className="content-measure-form"><CreateOrganizationForm onDone={() => select(null)} onCancel={() => select(null)} /></div>
            </div>
          ) : selected ? (
            <DetailC key={selected.id} row={selected} entering={dir.entering} onOpen={() => dir.open(selected)} />
          ) : (
            <EmptyState icon={<BuildingsIcon size={40} />} title="Pick an organization" description="Its keys, API access and members show here." padding="md" />
          )}
        </section>
      </div>
    </div>
  );
}

function ListItemC({ row, active, onSelect }: { row: OrgRow; active: boolean; onSelect: () => void }) {
  const keys = useKeysSaved(row.id);
  const needsWork = keys === false || row.memberCount === 0;
  return (
    <li className="border-b border-[var(--color-border-secondary)] last:border-b-0">
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? "true" : undefined}
        className={`flex min-h-[56px] w-full items-center gap-10 px-12 py-8 text-left ${active ? "bg-[var(--clr-dark-purple-5)] shadow-[inset_3px_0_0_var(--clr-dark-purple)]" : "hover:bg-[var(--clr-dark-purple-1)]"}`}
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="body-medium truncate font-medium">{row.name}</span>
          <span className="body-small truncate text-[var(--color-text-secondary)]">{row.current ? "Current · " : ""}{membersLabel(row.memberCount)}</span>
        </span>
        {needsWork && <WarningCircleIcon size={18} className="shrink-0 text-[var(--st-wait)]" aria-label="Needs setup" />}
      </button>
    </li>
  );
}

function DetailC({ row, entering, onOpen }: { row: OrgRow; entering: string | null; onOpen: () => void }) {
  const keys = useKeysSaved(row.id);
  const api = useApiAccessToggle(row);
  const [editingKeys, setEditingKeys] = useState(false);
  return (
    <article className="flex flex-col border-[1.5px] border-[var(--clr-dark-purple-40)] bg-[var(--paper)]">
      <header className="flex flex-wrap items-center justify-between gap-16 border-b border-[var(--color-border-secondary)] p-24">
        <div className="flex min-w-0 flex-col gap-4">
          <h2 className="title-heading-3 truncate">{row.name}</h2>
          <span className="body-small text-[var(--color-text-secondary)]">{membersLabel(row.memberCount)}</span>
        </div>
        {row.current ? (
          <span className="body-small font-medium text-[var(--color-text-secondary)]">You are working here</span>
        ) : (
          <Button type="button" variant="primary" busy={entering === row.id} onClick={onOpen}>Open organization</Button>
        )}
      </header>

      <div className="flex flex-col gap-12 border-b border-[var(--color-border-secondary)] p-24">
        <div className="flex flex-wrap items-center justify-between gap-12">
          <h3 className="title-chapter-title text-[var(--color-text-tertiary)]">Isometric keys</h3>
          {keys !== undefined && <StatusBadge status={keys ? "ready" : "draft"} label={keys ? "Saved" : "Missing"} />}
        </div>
        {editingKeys || keys === false ? (
          <div className="content-measure-form">
            <OrganizationCertifierCredentials organizationId={row.id} organizationName={row.name} />
          </div>
        ) : (
          <div><Button type="button" variant="weak" size="small" onClick={() => setEditingKeys(true)}>Replace keys</Button></div>
        )}
      </div>

      <div className="flex flex-col gap-12 border-b border-[var(--color-border-secondary)] p-24">
        <h3 className="title-chapter-title text-[var(--color-text-tertiary)]">API access</h3>
        <div className="flex flex-wrap items-center justify-between gap-12">
          <p className="body-small">{row.apiAccess === undefined ? "Could not be loaded." : row.apiAccess ? "On. The organization's API keys work." : "Off. The organization's API keys do not work."}</p>
          <Button type="button" variant="weak" size="small" busy={api.pending} disabled={row.apiAccess === undefined} onClick={api.request}>{api.label}</Button>
        </div>
      </div>

      <div className="flex flex-col gap-8 p-24">
        <h3 className="title-chapter-title text-[var(--color-text-tertiary)]">Members</h3>
        <p className="body-small text-[var(--color-text-secondary)]">
          {row.memberCount === 0 ? "Nobody can sign in to this organization yet. Open it and invite an Admin in Settings, Members." : `${membersLabel(row.memberCount)}. Manage them in Settings, Members after opening the organization.`}
        </p>
      </div>
      {api.dialog}
    </article>
  );
}
