/**
 * PROTOTYPE (#1373) Variant B, "Platform shell": Platform gets its own
 * frame instead of borrowing an organization's sidebar. Its rail holds the
 * three Platform pages (Organizations, Diagnostics, Template mapping move
 * out of Settings). Each organization is one row with Open; the row opens a
 * side sheet with its status and the admin actions.
 *
 * The prototype draws the shell as a fixed layer over the app layout; the
 * real version would be its own route group layout.
 */
"use client";

import { useState } from "react";
import {
  ArrowRightIcon,
  BuildingsIcon,
  CaretRightIcon,
  ListIcon,
  PlusIcon,
  PulseIcon,
  SignOutIcon,
  TreeStructureIcon,
} from "@phosphor-icons/react/dist/ssr";
import { Button, EmptyState, NomaLogo, SlideOverPanel, StatusBadge } from "@/components/ui";
import { Skeleton } from "@/components/ui/loading-skeleton";
import {
  CreateOrganizationForm,
  KeysDialog,
  membersLabel,
  useApiAccessToggle,
  useKeysSaved,
  useOrgDirectory,
  type OrgRow,
} from "./shared";

const NAV = [
  { label: "Organizations", icon: BuildingsIcon, active: true },
  { label: "Diagnostics", icon: PulseIcon, active: false },
  { label: "Template mapping", icon: TreeStructureIcon, active: false },
];

export function VariantB() {
  const dir = useOrgDirectory();
  const [sheet, setSheet] = useState<{ mode: "view"; id: string } | { mode: "create" } | null>(null);
  const selected = sheet?.mode === "view" ? dir.rows.find((r) => r.id === sheet.id) ?? null : null;

  return (
    <div className="fixed inset-0 z-[35] flex flex-col bg-[var(--bg)] md:flex-row">
      <aside className="flex shrink-0 flex-col bg-[var(--clr-dark-purple)] text-white md:w-[240px]">
        <div className="flex h-56 items-center justify-between gap-12 px-16 md:h-auto md:flex-col md:items-start md:py-20">
          <div className="flex items-center gap-10">
            <NomaLogo className="h-20 w-auto text-white" />
            <span className="body-small-bold uppercase tracking-[0.08em] text-[var(--color-white-70,rgba(255,255,255,0.7))]">Platform</span>
          </div>
          <ListIcon size={24} className="md:hidden" aria-hidden />
        </div>
        <nav aria-label="Platform" className="hidden flex-col gap-2 px-8 md:flex">
          {NAV.map((item) => (
            <span
              key={item.label}
              className={`body-small flex min-h-44 items-center gap-10 px-10 ${item.active ? "bg-[rgba(255,255,255,0.12)] font-medium" : "text-[rgba(255,255,255,0.7)]"}`}
            >
              <item.icon size={18} /> {item.label}
            </span>
          ))}
        </nav>
        <div className="mt-auto hidden items-center justify-between gap-8 border-t border-[rgba(255,255,255,0.12)] px-16 py-12 md:flex">
          <span className="body-small truncate">Platform Admin</span>
          <SignOutIcon size={18} aria-label="Sign out" />
        </div>
      </aside>

      <main className="min-h-0 flex-1 overflow-auto">
        <div className="container-max page-shell">
          <div className="flex flex-wrap items-end justify-between gap-16">
            <div className="flex flex-col gap-4">
              <h1 className="title-heading-2">Organizations</h1>
              <p className="body-small text-[var(--color-text-secondary)]">{dir.rows.length} on noma. Open one to work inside it.</p>
            </div>
            <Button type="button" variant="primary" onClick={() => setSheet({ mode: "create" })}>
              <PlusIcon size={16} weight="bold" /> New organization
            </Button>
          </div>

          {dir.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : dir.rows.length === 0 ? (
            <EmptyState icon={<BuildingsIcon size={40} />} title="No organizations yet" description="Create the first organization to onboard an operator." padding="md" />
          ) : (
            <ul className="flex flex-col border-[1.5px] border-[var(--clr-dark-purple-40)] bg-[var(--paper)]">
              {dir.rows.map((row) => (
                <RowB key={row.id} row={row} entering={dir.entering} onOpen={() => dir.open(row)} onDetails={() => setSheet({ mode: "view", id: row.id })} />
              ))}
            </ul>
          )}
        </div>
      </main>

      <SlideOverPanel.Root open={sheet !== null} onOpenChange={(open) => !open && setSheet(null)}>
        <SlideOverPanel.Content size="narrow">
          <SlideOverPanel.Header>
            <SlideOverPanel.Title>{sheet?.mode === "create" ? "New organization" : selected?.name ?? ""}</SlideOverPanel.Title>
            {selected && <SlideOverPanel.Description>{membersLabel(selected.memberCount)}</SlideOverPanel.Description>}
          </SlideOverPanel.Header>
          <SlideOverPanel.Body className="flex flex-col gap-24">
            {sheet?.mode === "create" && <CreateOrganizationForm onDone={() => setSheet(null)} onCancel={() => setSheet(null)} />}
            {selected && <OrgDetailsB row={selected} entering={dir.entering} onOpen={() => dir.open(selected)} />}
          </SlideOverPanel.Body>
        </SlideOverPanel.Content>
      </SlideOverPanel.Root>
    </div>
  );
}

function RowB({ row, entering, onOpen, onDetails }: { row: OrgRow; entering: string | null; onOpen: () => void; onDetails: () => void }) {
  const keys = useKeysSaved(row.id);
  const warnings = [keys === false && "No Isometric keys", row.memberCount === 0 && "No members"].filter(Boolean) as string[];
  return (
    <li className="flex items-center gap-12 border-b border-[var(--color-border-secondary)] last:border-b-0">
      <button type="button" onClick={onDetails} className="flex min-h-[64px] min-w-0 flex-1 items-center gap-12 px-16 py-12 text-left hover:bg-[var(--clr-dark-purple-5)]">
        <BuildingsIcon size={22} className="hidden shrink-0 text-[var(--color-icon-secondary)] md:block" />
        <span className="flex min-w-0 flex-col">
          <span className="body-medium font-medium md:truncate">{row.name}</span>
          <span className="body-small text-[var(--color-text-secondary)] md:truncate">
            {warnings.length > 0 ? warnings.join(" · ") : `${membersLabel(row.memberCount)} · Keys saved`}
          </span>
        </span>
        <CaretRightIcon size={16} className="ml-auto hidden shrink-0 text-[var(--color-icon-secondary)] md:block" />
      </button>
      <div className="shrink-0 pr-16">
        {row.current ? (
          <span className="body-small font-medium text-[var(--color-text-secondary)]">Current</span>
        ) : (
          <Button type="button" variant="weak" size="small" busy={entering === row.id} disabled={entering !== null && entering !== row.id} onClick={onOpen}>
            Open <ArrowRightIcon size={14} />
          </Button>
        )}
      </div>
    </li>
  );
}

function OrgDetailsB({ row, entering, onOpen }: { row: OrgRow; entering: string | null; onOpen: () => void }) {
  const keys = useKeysSaved(row.id);
  const [keysOpen, setKeysOpen] = useState(false);
  const api = useApiAccessToggle(row);
  return (
    <>
      {!row.current && (
        <Button type="button" variant="primary" busy={entering === row.id} onClick={onOpen}>Open {row.name}</Button>
      )}
      <section className="flex flex-col gap-8 border-t border-[var(--color-border-secondary)] pt-16">
        <h3 className="title-chapter-title text-[var(--color-text-tertiary)]">Isometric keys</h3>
        <div className="flex flex-wrap items-center justify-between gap-12">
          {keys !== undefined && <StatusBadge status={keys ? "ready" : "draft"} label={keys ? "Saved" : "Missing"} />}
          <Button type="button" variant="weak" size="small" onClick={() => setKeysOpen(true)}>{keys ? "Replace keys" : "Add keys"}</Button>
        </div>
      </section>
      <section className="flex flex-col gap-8 border-t border-[var(--color-border-secondary)] pt-16">
        <h3 className="title-chapter-title text-[var(--color-text-tertiary)]">API access</h3>
        <p className="body-small text-[var(--color-text-secondary)]">
          {row.apiAccess ? "On. The organization's API keys work." : "Off. The organization's API keys do not work."}
        </p>
        <div>
          <Button type="button" variant="weak" size="small" busy={api.pending} disabled={row.apiAccess === undefined} onClick={api.request}>{api.label}</Button>
        </div>
      </section>
      <KeysDialog org={row} isOpen={keysOpen} onClose={() => setKeysOpen(false)} />
      {api.dialog}
    </>
  );
}
