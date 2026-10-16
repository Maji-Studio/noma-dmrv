"use client";

/** PROTOTYPE (throwaway): building blocks shared by the three variants. */
import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  ArrowRightIcon,
  ArrowSquareOutIcon,
  CheckIcon,
  DotsThreeIcon,
  LockSimpleIcon,
  PencilSimpleIcon,
} from "@phosphor-icons/react/dist/ssr";
import { Button, buttonVariants } from "@/components/ui/button";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { CreditBatchRemovalTemplate } from "@/components/credit-batches/credit-batch-removal-template";
import { formatDate, formatTonnes } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import { useProto } from "./prototype-context";
import {
  PROGRESS_STEPS,
  SAMPLES_REQUIRED,
  TAB_LABELS,
  type ItemGroup,
  type LockableField,
  type OpenItem,
  type RemovalRef,
} from "./prototype-model";

export const PANEL = "border border-[var(--clr-dark-purple-40)] bg-[var(--paper)]";
const MUTED = "text-[var(--color-text-secondary)]";

export const GROUP_META: Record<ItemGroup, { title: string; help: string; dot: string }> = {
  blocking: { title: "Blocking", help: "Fix these before the next Removal.", dot: "bg-[var(--st-bad)]" },
  check: { title: "Check", help: "Worth a look. These do not stop a Removal.", dot: "bg-[var(--st-wait)]" },
  waiting: { title: "Waiting", help: "With someone else. Nothing to do yet.", dot: "bg-[var(--st-off)]" },
};

export function tonnes(value: number): string {
  return formatTonnes(value);
}

export function Panel({ title, action, children, className }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn(PANEL, "flex flex-col gap-16 p-20", className)}>
      {(title || action) && (
        <div className="flex min-h-32 items-center justify-between gap-12">
          {title && <h2 className="title-heading-3">{title}</h2>}
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
      className={cn(focused && "outline outline-2 outline-offset-2 outline-[var(--color-interaction)] bg-[var(--st-run-bg)]", className)}
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
      <StatusBadge status={removal.status === "submitted" ? "pending" : removal.status} label={removal.status === "submitted" ? "Sent" : undefined} size="small" />
    </span>
  );
}

/** The four lifecycle steps as a horizontal track. */
export function ProgressSteps({ vertical = false }: { vertical?: boolean }) {
  const { model } = useProto();
  return (
    <ol className={cn("flex gap-0", vertical ? "flex-col" : "flex-row")} aria-label="Batch progress">
      {PROGRESS_STEPS.map((step, index) => {
        const done = index < model.progressIndex || (model.progressIndex === 3 && index === 3);
        const current = index === model.progressIndex && !done;
        return (
          <li key={step} aria-current={current ? "step" : undefined} className={cn("flex min-w-0 gap-8", vertical ? "items-center py-6" : "flex-1 flex-col")}>
            <span className={cn("flex items-center", vertical ? "" : "gap-0")}>
              <span
                className={cn(
                  "flex size-18 shrink-0 items-center justify-center rounded-full border",
                  done && "border-[var(--st-ok)] bg-[var(--st-ok)] text-white",
                  current && "border-[var(--st-run)] bg-[var(--st-run)]",
                  !done && !current && "border-[var(--st-off)] bg-[var(--paper)]",
                )}
              >
                {done && <CheckIcon size={11} weight="bold" aria-hidden />}
              </span>
              {!vertical && index < PROGRESS_STEPS.length - 1 && (
                <span className={cn("ml-6 mr-6 h-px flex-1", done ? "bg-[var(--st-ok)]" : "bg-[var(--st-off)]")} aria-hidden />
              )}
            </span>
            <span className={cn("body-small", current || done ? "font-medium" : MUTED)}>{step}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function LockPill() {
  const { model } = useProto();
  const open = model.lockLevel === "Open";
  return (
    <span className="inline-flex items-center gap-6 border border-[var(--color-border-secondary)] px-8 py-2 body-caption font-medium">
      <LockSimpleIcon size={12} weight={open ? "regular" : "fill"} aria-hidden />
      {model.lockLevel === "Open" ? "Open, all fields editable" : model.lockLevel === "Partly sent" ? "Partly sent, some fields locked" : "Fully sent, locked"}
    </span>
  );
}

/** The key-number strip: applied mass, estimate, samples, open items. */
export function KeyNumbers({ className }: { className?: string }) {
  const { model, go } = useProto();
  const cells: { label: string; value: string; sub?: string; onClick?: () => void }[] = [
    { label: "Biochar applied", value: tonnes(model.appliedTons), sub: `${tonnes(model.masses.notIn)} not in a Removal` },
    { label: "Carbon estimate", value: `≈ ${formatTonnes(model.co2eTons ?? 0, { unit: "t CO₂e" })}`, sub: "Before project emissions" },
    {
      label: "Lab samples",
      value: `${model.samples} of ${SAMPLES_REQUIRED}`,
      sub: model.samples >= SAMPLES_REQUIRED ? "Enough for Method B" : "Method B needs three",
      onClick: () => go("production", "samples"),
    },
    {
      label: "Open items",
      value: String(model.openCount),
      sub: model.blocking.length > 0 ? `${model.blocking.length} blocking` : "None blocking",
      onClick: () => go("overview"),
    },
  ];
  return (
    <dl className={cn("grid grid-cols-2 border border-[var(--clr-dark-purple-40)] bg-[var(--paper)] lg:grid-cols-4", className)}>
      {cells.map((cell, index) => (
        <div key={cell.label} className={cn("flex flex-col gap-4 p-16", index % 2 === 1 && "border-l border-[var(--color-border-tertiary)]", index >= 2 && "border-t border-[var(--color-border-tertiary)] lg:border-t-0", index > 0 && "lg:border-l lg:border-[var(--color-border-tertiary)]")}>
          <dt className={cn("body-small", MUTED)}>{cell.label}</dt>
          <dd className="title-heading-3 tabular-nums">{cell.value}</dd>
          {cell.sub && <dd className={cn("body-caption", MUTED)}>{cell.sub}</dd>}
        </div>
      ))}
    </dl>
  );
}

export function OpenItemRow({ item, compact = false }: { item: OpenItem; compact?: boolean }) {
  const { go } = useProto();
  const meta = GROUP_META[item.group];
  return (
    <li className={cn("flex gap-8 border-t border-[var(--color-border-tertiary)] first:border-t-0 flex-col", compact ? "flex-col py-10" : "sm:flex-row sm:items-start sm:justify-between sm:gap-16 py-12")}>
      <div className="flex min-w-0 gap-10">
        <span className={cn("mt-6 size-8 shrink-0 rounded-full", meta.dot)} aria-hidden />
        <div className="flex min-w-0 flex-col gap-2">
          <span className="body-medium font-medium">{item.title}</span>
          {item.detail && !compact && <span className={cn("body-small", MUTED)}>{item.detail}</span>}
          <span className={cn("body-caption", MUTED)}>In {TAB_LABELS[item.tab]}</span>
        </div>
      </div>
      <div className={cn("flex shrink-0 flex-wrap items-center gap-8 pl-18", !compact && "sm:pl-0")}>
        <Button variant={item.group === "blocking" ? "default" : "weak"} size="small" onClick={() => go(item.tab, item.rowId)}>
          {item.actionLabel}
          <ArrowRightIcon size={14} aria-hidden />
        </Button>
        {item.externalHref && (
          <Link href={item.externalHref} className={cn(buttonVariants({ variant: "noOutline", size: "small" }))} aria-label={`${item.actionLabel}, opens another page`}>
            <ArrowSquareOutIcon size={14} aria-hidden />
          </Link>
        )}
      </div>
    </li>
  );
}

export function OpenItemGroups({ groups = ["blocking", "check", "waiting"], compact = false }: { groups?: ItemGroup[]; compact?: boolean }) {
  const { model } = useProto();
  const lists: Record<ItemGroup, OpenItem[]> = { blocking: model.blocking, check: model.check, waiting: model.waiting };
  const shown = groups.filter((group) => lists[group].length > 0);
  if (shown.length === 0) {
    return <p className={cn("body-medium", MUTED)}>Nothing is open on this batch.</p>;
  }
  return (
    <div className="flex flex-col gap-20">
      {shown.map((group) => (
        <div key={group} className="flex flex-col gap-4">
          <h3 className="body-small font-medium">
            {GROUP_META[group].title} <span className={MUTED}>({lists[group].length})</span>
          </h3>
          <p className={cn("body-caption", MUTED)}>{GROUP_META[group].help}</p>
          <ul className="flex flex-col">
            {lists[group].map((item) => (
              <OpenItemRow key={item.id} item={item} compact={compact} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function PrimaryAction() {
  const { model, go, say } = useProto();
  const { primary } = model;
  if (primary.kind === "none") {
    return <span className="inline-flex items-center gap-6 body-small font-medium text-[var(--st-ok)]"><CheckIcon size={14} weight="bold" aria-hidden />Credits issued</span>;
  }
  const onClick = () => {
    if (primary.kind === "fix") go(model.blocking[0].tab, model.blocking[0].rowId);
    else if (primary.kind === "start") say("Prototype: this opens the New Removal wizard with the unassigned mass.");
    else go("removals", "ghg");
  };
  return (
    <Button variant="primary" onClick={onClick} title={primary.hint}>
      {primary.label}
    </Button>
  );
}

export function OverflowMenu() {
  const { batch, say } = useProto();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger render={<Button variant="weak" size="icon" aria-label="More actions" />}>
        <DotsThreeIcon size={20} weight="bold" aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        <DropdownMenu.Item render={<Link href={`/traceability?batch=${batch.id}&facility=${batch.facilityId}`} />}>Open in Traceability</DropdownMenu.Item>
        <DropdownMenu.Separator />
        <DropdownMenu.Item destructive onClick={() => say("Prototype: delete asks for confirmation first.")}>Delete credit batch</DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

/** One field in the details panel: editable, or read-only with a how-to link. */
function DetailRow({ field, label, value, editing, input }: { field: LockableField | null; label: string; value: string; editing: boolean; input?: ReactNode }) {
  const { model, go } = useProto();
  const lock = field ? model.locks[field] : undefined;
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-4 border-t border-[var(--color-border-tertiary)] py-10 first:border-t-0">
      <div className="flex items-baseline justify-between gap-12">
        <dt className={cn("body-small", MUTED)}>{label}</dt>
        {lock && (
          <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-4 body-caption font-medium underline">
            <LockSimpleIcon size={12} weight="fill" aria-hidden />
            How to change
          </button>
        )}
      </div>
      <dd className="body-medium">
        {editing && !lock && input ? input : (
          <span className="inline-flex items-center gap-6">
            {lock && <LockSimpleIcon size={14} aria-hidden />}
            {value}
          </span>
        )}
      </dd>
      {lock && open && (
        <p className={cn("body-caption", MUTED)}>
          {lock.reason} {lock.howTo}{" "}
          <button type="button" className="font-medium underline" onClick={() => go("removals", lock.focus)}>Show in Removals</button>
        </p>
      )}
    </div>
  );
}

/** Batch details: definition, Removal template, sampling, gas composition, notes. */
export function DetailsPanel({ className }: { className?: string }) {
  const { batch, canManage, model, say } = useProto();
  const [editing, setEditing] = useState(false);
  const gas = [
    ["CH₄", batch.ch4CompositionPercent],
    ["CO", batch.coCompositionPercent],
    ["CO₂", batch.co2CompositionPercent],
    ["N₂O", batch.n2oCompositionPercent],
  ] as const;
  const gasText = gas.every(([, v]) => v == null) ? "Not recorded" : gas.map(([name, v]) => `${name} ${v ?? "n/a"}%`).join(", ");
  return (
    <Panel
      title="Batch details"
      className={className}
      action={
        <Button variant="weak" size="small" onClick={() => (editing ? (setEditing(false), say("Prototype: changes would save here.")) : setEditing(true))}>
          <PencilSimpleIcon size={14} aria-hidden />
          {editing ? "Save details" : "Edit details"}
        </Button>
      }
    >
      <dl className="flex flex-col">
        <DetailRow field="feedstock" label="Feedstock" value={batch.feedstockTypeName ?? "Not recorded"} editing={editing} />
        <DetailRow field="startDate" label="Start date" value={formatDate(batch.startDate)} editing={editing} input={<Input type="date" defaultValue={String(batch.startDate).slice(0, 10)} aria-label="Start date" />} />
        <DetailRow field="endDate" label="End date" value={formatDate(batch.endDate)} editing={editing} input={<Input type="date" defaultValue={String(batch.endDate).slice(0, 10)} aria-label="End date" />} />
        <DetailRow field="appliedMass" label="Applied biochar" value={tonnes(model.appliedTons)} editing={false} />
        <DetailRow field="sampling" label="Sampling" value={batch.sampling === "sampled" ? "Sampled" : "Unsampled"} editing={false} />
        <DetailRow field={null} label="Gas composition" value={gasText} editing={editing} input={<Input defaultValue={gasText} aria-label="Gas composition" />} />
        <DetailRow field={null} label="Notes" value={batch.siteManagementNotes || "No notes"} editing={editing} input={<Input defaultValue={batch.siteManagementNotes ?? ""} aria-label="Notes" />} />
      </dl>
      <div className="border-t border-[var(--color-border-tertiary)] pt-12">
        {model.scenario === "blocking" ? (
          <CreditBatchRemovalTemplate creditBatch={batch} canManage={canManage} locked={model.locks.template != null} />
        ) : (
          // PROTOTYPE: a sent Removal needs a template, so these scenarios show a stub pin.
          <dl>
            <DetailRow field="template" label="Removal template" value="Mafinga biochar, sandbox v2" editing={false} />
          </dl>
        )}
      </div>
    </Panel>
  );
}

/** The Removals and GHG Statement this batch feeds. */
export function FedPanel({ className }: { className?: string }) {
  const { model, go } = useProto();
  return (
    <Panel title="Feeds" className={className}>
      {model.removals.length === 0 ? (
        <p className={cn("body-small", MUTED)}>No Removal holds this batch yet. {model.blocking.length > 0 ? "Clear the blocking items first." : "Start a Removal to send it."}</p>
      ) : (
        <ul className="flex flex-col">
          {model.removals.map((removal) => (
            <li key={removal.code} className="flex flex-col gap-2 border-t border-[var(--color-border-tertiary)] py-8 first:border-t-0">
              <RemovalChip removal={removal} />
              <span className={cn("body-caption", MUTED)}>{removal.statusNote}</span>
            </li>
          ))}
        </ul>
      )}
      {model.scenario !== "blocking" && model.scenario !== "clear" && (
        <button type="button" onClick={() => go("removals", "ghg")} className="flex flex-col gap-2 border-t border-[var(--color-border-tertiary)] pt-12 text-left">
          <span className="body-small font-medium underline">GHG Statement, Q3</span>
          <span className={cn("body-caption", MUTED)}>{model.scenario === "issued" ? "Verified, credits issued" : "With the verifier"}</span>
        </button>
      )}
    </Panel>
  );
}
