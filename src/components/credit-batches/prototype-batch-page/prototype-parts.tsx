"use client";

/** PROTOTYPE (throwaway): panels and rows used by the overview and the tabs. */
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRightIcon, ArrowSquareOutIcon, CheckCircleIcon, LockSimpleIcon } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { InfoHint } from "@/components/ui/tooltip";
import { CreditBatchRemovalTemplate } from "@/components/credit-batches/credit-batch-removal-template";
import { formatDate, formatTonnes } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import { useProto } from "./prototype-context";
import { RemovalMassBar, useBarTotal } from "./prototype-mass-bar";
import type { ItemGroup, LockableField, OpenItem, RemovalRef } from "./prototype-model";

export const PANEL = "border border-[var(--color-border-secondary)] bg-[var(--paper)]";
const MUTED = "text-[var(--color-text-secondary)]";
const ROW_RULE = "border-t border-[var(--color-border-tertiary)] first:border-t-0";

export const GROUP_META: Record<ItemGroup, { title: string; help: string; dot: string }> = {
  blocking: { title: "Blocking", help: "Fix these before the next Removal.", dot: "bg-[var(--st-bad)]" },
  check: { title: "Check", help: "Worth a look. These do not stop a Removal.", dot: "bg-[var(--st-wait)]" },
  waiting: { title: "Waiting", help: "With someone else. Nothing to do yet.", dot: "bg-[var(--st-off)]" },
};

/** A square chip for a record's identity facts (feedstock, code), as on the list cards. */
export function Chip({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-6 border border-[var(--clr-dark-purple-20)] bg-[var(--clr-dark-purple-10)] px-8 py-2 body-small text-[var(--clr-dark-purple)]">
      {icon}
      {children}
    </span>
  );
}

/** Round count badge: red when the count blocks, quiet otherwise. Same badge as the Overview tab. */
export function CountBadge({ count, blocking, label }: { count: number; blocking: boolean; label: string }) {
  return (
    <span
      aria-label={label}
      className={cn(
        "inline-flex min-w-20 items-center justify-center rounded-full px-6 body-caption font-medium tabular-nums",
        blocking ? "bg-[var(--st-bad)] text-white" : "bg-[var(--sea)]",
      )}
    >
      {count}
    </span>
  );
}

export function tonnes(value: number): string {
  return formatTonnes(value);
}

export function Panel({ title, titleAddon, action, children, className }: { title?: string; titleAddon?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn(PANEL, "flex flex-col gap-16 p-20 sm:p-24", className)}>
      {(title || action) && (
        <div className="flex min-h-40 items-center justify-between gap-12">
          {title && (
            <span className="inline-flex items-center gap-8">
              <h2 className="title-heading-3">{title}</h2>
              {titleAddon}
            </span>
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** Wraps a row so ?focus=<rowId> highlights it and scrolls it into view once. */
export function FocusRow({ rowId, className, children }: { rowId: string; className?: string; children: ReactNode }) {
  const { focus } = useProto();
  const focused = focus === rowId;
  return (
    <div
      id={`row-${rowId}`}
      data-focused={focused || undefined}
      ref={(node) => {
        if (node && focused && !node.dataset.scrolled) {
          node.dataset.scrolled = "1";
          node.scrollIntoView({ block: "center" });
        }
      }}
      className={cn(className, focused && "bg-[var(--st-run-bg)] outline outline-1 outline-[var(--st-run-border)]")}
    >
      {children}
    </div>
  );
}

export function RemovalChip({ removal }: { removal: RemovalRef | null }) {
  if (!removal) return <span className={cn("body-small", MUTED)}>Not in a Removal</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-8">
      <span className="body-small font-medium">{removal.code}</span>
      {/* Same labels as SubmissionStatusBadge: a Removal ends at Submitted. */}
      <StatusBadge status={removal.status === "submitted" ? "issued" : "draft"} label={removal.status === "submitted" ? "Submitted" : undefined} size="small" />
    </span>
  );
}

const ROW_TARGET = "group -mx-12 flex min-h-44 w-[calc(100%+24px)] flex-col gap-8 px-12 py-12 text-left hover:bg-[var(--color-surface-medium)] sm:flex-row sm:items-center sm:justify-between sm:gap-24";

/** One open item. The whole row is the target: an in-page jump, or the repair page when the fix lives elsewhere. */
export function OpenItemRow({ item }: { item: OpenItem }) {
  const { go, setEditing } = useProto();
  const body = (
    <>
      <span className="flex min-w-0 flex-col gap-2">
        <span className="body-medium font-medium">{item.title}</span>
        {item.detail && <span className={cn("body-small", MUTED)}>{item.detail}</span>}
      </span>
      <span className="inline-flex shrink-0 items-center gap-6 label-button group-hover:underline">
        {item.actionLabel}
        {item.externalHref ? <ArrowSquareOutIcon size={16} aria-hidden /> : <ArrowRightIcon size={16} aria-hidden />}
      </span>
    </>
  );
  return (
    <li className={ROW_RULE}>
      {item.externalHref ? (
        <Link href={item.externalHref} className={ROW_TARGET}>
          {body}
        </Link>
      ) : (
        <button
          type="button"
          className={ROW_TARGET}
          onClick={() => {
            if (item.rowId === "template" || item.rowId === "details") setEditing(true);
            go(item.tab, item.rowId);
          }}
        >
          {body}
        </button>
      )}
    </li>
  );
}

export function OpenItemGroups() {
  const { model } = useProto();
  const lists: Record<ItemGroup, OpenItem[]> = { blocking: model.blocking, check: model.check, waiting: model.waiting };
  const shown = (["blocking", "check", "waiting"] as const).filter((group) => lists[group].length > 0);
  if (shown.length === 0) {
    return <EmptyState padding="sm" icon={<CheckCircleIcon size={32} weight="thin" />} title="Nothing is open on this batch" />;
  }
  return (
    <div className="flex flex-col gap-28">
      {shown.map((group) => (
        <section key={group} aria-labelledby={`group-${group}`} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 border-b border-[var(--color-border-secondary)] pb-8">
            <h3 id={`group-${group}`} className="inline-flex items-center gap-8 body-small font-medium">
              <span className={cn("size-8 rounded-full", GROUP_META[group].dot)} aria-hidden />
              {GROUP_META[group].title}
              <span className={cn("tabular-nums", MUTED)}>{lists[group].length}</span>
            </h3>
            <span className={cn("body-caption", MUTED)}>{GROUP_META[group].help}</span>
          </div>
          <ul className="flex flex-col">
            {lists[group].map((item) => (
              <OpenItemRow key={item.id} item={item} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** One field in the details panel, label left and value right. Locked fields explain themselves in the ⓘ. */
function DetailRow({ field, label, value, editing, input }: { field: LockableField | null; label: string; value: string; editing: boolean; input?: ReactNode }) {
  const { model } = useProto();
  // When everything is locked the panel says so once; rows stay quiet.
  const lock = field && model.lockLevel !== "Fully sent" ? model.locks[field] : undefined;
  return (
    <div className={cn("grid grid-cols-[136px_minmax(0,1fr)] items-baseline gap-12 py-10", ROW_RULE)}>
      <dt className={cn("body-small", MUTED)}>{label}</dt>
      <dd className="flex min-w-0 items-center gap-6 body-medium">
        {editing && !lock && input ? input : (
          <>
            <span className="min-w-0">{value}</span>
            {lock && (
              <>
                <LockSimpleIcon size={14} className="shrink-0 text-[var(--color-text-secondary)]" aria-hidden />
                <InfoHint label={`Why ${label.toLowerCase()} is locked`}>
                  {lock.reason} {lock.howTo}
                </InfoHint>
              </>
            )}
          </>
        )}
      </dd>
    </div>
  );
}

/** Shown only when something is locked; an editable batch needs no symbol. */
function LockMark() {
  const { model } = useProto();
  if (model.lockLevel === "Open") return null;
  const lock = model.locks.endDate ?? model.locks.startDate;
  const text = model.lockLevel === "Fully sent" ? "All fields are locked." : "Some fields are locked.";
  return (
    <span className="inline-flex items-center gap-2 text-[var(--color-text-secondary)]">
      <LockSimpleIcon size={20} aria-hidden />
      <InfoHint label="Why fields are locked">
        {text} {lock?.reason} {lock?.howTo}
      </InfoHint>
    </span>
  );
}

/** Batch details: definition, Removal template, sampling, gas composition, notes. Edit starts from the header. */
export function DetailsPanel({ className }: { className?: string }) {
  const { batch, canManage, model, editing, setEditing, say } = useProto();
  const gas = [
    ["CH₄", batch.ch4CompositionPercent],
    ["CO", batch.coCompositionPercent],
    ["CO₂", batch.co2CompositionPercent],
    ["N₂O", batch.n2oCompositionPercent],
  ] as const;
  const gasText = gas.every(([, v]) => v == null) ? "Not recorded" : gas.map(([name, v]) => (v == null ? `${name} not recorded` : `${name} ${v}%`)).join(", ");
  return (
    <FocusRow rowId="details">
      <Panel title="Batch details" titleAddon={<LockMark />} className={className}>
        <dl className="flex flex-col">
          <DetailRow field="feedstock" label="Feedstock" value={batch.feedstockTypeName ?? "Not recorded"} editing={editing} />
          <DetailRow field="startDate" label="Start date" value={formatDate(batch.startDate)} editing={editing} input={<Input type="date" defaultValue={String(batch.startDate).slice(0, 10)} aria-label="Start date" />} />
          <DetailRow field="endDate" label="End date" value={formatDate(batch.endDate)} editing={editing} input={<Input type="date" defaultValue={String(batch.endDate).slice(0, 10)} aria-label="End date" />} />
          <DetailRow field="appliedMass" label="Applied biochar" value={tonnes(model.appliedTons)} editing={false} />
          <DetailRow field="sampling" label="Sampling" value={batch.sampling === "sampled" ? "Sampled" : "Unsampled"} editing={false} />
          <DetailRow field={null} label="Gas composition" value={gasText} editing={editing} input={<Input defaultValue={gasText} aria-label="Gas composition" />} />
          <DetailRow field={null} label="Notes" value={batch.siteManagementNotes || "Not recorded"} editing={editing} input={<Input defaultValue={batch.siteManagementNotes ?? ""} aria-label="Notes" />} />
        </dl>
        {editing && (
          <div className="flex flex-wrap gap-12">
            <Button variant="primary" onClick={() => (setEditing(false), say("Prototype: changes would save here."))}>Save changes</Button>
            <Button variant="noOutline" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        )}
        {/* Switching the template is an edit: its action shows in Edit mode only, one CTA per screen. */}
        <FocusRow rowId="template" className="border-t border-[var(--color-border-secondary)] pt-16">
          {model.scenario === "blocking" ? (
            <CreditBatchRemovalTemplate creditBatch={batch} canManage={canManage && editing} locked={model.locks.template != null} />
          ) : (
            // PROTOTYPE: a sent Removal needs a template, so these scenarios show a stub pin.
            <dl>
              <DetailRow field="template" label="Removal template" value="Mafinga biochar, sandbox v2" editing={false} />
            </dl>
          )}
        </FocusRow>
      </Panel>
    </FocusRow>
  );
}

/** Where the applied biochar sits: each Removal with its mass, the part in none, and the GHG Statement. */
export function RemovalsPanel() {
  const { model, go } = useProto();
  const total = useBarTotal();
  return (
    <Panel
      title="Removals"
      action={
        <span className="inline-flex items-center gap-16">
          <span className="body-medium tabular-nums">{total}</span>
          <button type="button" onClick={() => go("removals")} className={cn("inline-flex items-center gap-4 body-small underline-offset-2 hover:underline", MUTED)}>
            Details
            <ArrowRightIcon size={14} aria-hidden />
          </button>
        </span>
      }
    >
      {model.removals.length === 0 && (
        <p className={cn("body-small", MUTED)}>This credit batch is ready. Select Start Removal to submit its applied biochar.</p>
      )}
      <RemovalMassBar compact />
    </Panel>
  );
}
