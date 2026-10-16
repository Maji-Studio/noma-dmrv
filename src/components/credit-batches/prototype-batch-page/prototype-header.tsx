"use client";

/** PROTOTYPE (throwaway): page header, progress steps and key numbers. */
import Link from "next/link";
import { ArrowLeftIcon, CheckIcon, DotsThreeIcon, LeafIcon, PencilSimpleIcon } from "@phosphor-icons/react/dist/ssr";
import { PageHeader } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { formatDateRange, formatTonnes } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import { useProto } from "./prototype-context";
import { SAMPLES_REQUIRED } from "./prototype-model";
import { Chip, CountBadge } from "./prototype-parts";

const MUTED = "text-[var(--color-text-secondary)]";

function PrimaryAction() {
  const { model, go, say, setEditing } = useProto();
  const { primary } = model;
  if (primary.kind === "none") {
    return (
      <span className="inline-flex h-40 items-center gap-6 body-small font-medium text-[var(--st-ok)]">
        <CheckIcon size={16} weight="bold" aria-hidden />
        Credits issued
      </span>
    );
  }
  const onClick = () => {
    if (primary.kind === "fix") {
      const next = model.blocking[0];
      if (next.rowId === "template" || next.rowId === "details") setEditing(true);
      go(next.tab, next.rowId);
    }
    else if (primary.kind === "start") say("Prototype: this opens the New Removal wizard with the unassigned mass.");
    else go("removals", "ghg");
  };
  return (
    <Button variant="primary" onClick={onClick} title={primary.hint}>
      {primary.label}
    </Button>
  );
}

function OverflowMenu() {
  const { batch, say } = useProto();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger render={<Button variant="weak" width="square" aria-label="More actions" />}>
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

/** The four lifecycle steps as segments: a bar, the step, and what it is at (a date, a record, a holder). */
function ProgressSteps() {
  const { model } = useProto();
  return (
    <ol className="grid grid-cols-2 gap-x-4 gap-y-16 sm:grid-cols-4" aria-label="Batch progress">
      {model.progress.map((step) => (
        <li key={step.label} aria-current={step.state === "current" ? "step" : undefined} className="flex min-w-0 flex-col gap-8">
          <span
            aria-hidden
            className={cn(
              "h-4 w-full",
              step.state === "done" && "bg-[var(--st-ok)]",
              step.state === "current" && "bg-[var(--ink)]",
              step.state === "todo" && "bg-[var(--color-border-tertiary)]",
            )}
          />
          <span className="flex min-w-0 flex-col gap-2 pr-12">
            <span className={cn("inline-flex items-center gap-6 body-small", step.state === "todo" ? MUTED : "font-medium")}>
              {step.state === "done" && <CheckIcon size={14} weight="bold" className="shrink-0 text-[var(--st-ok)]" aria-hidden />}
              {step.label}
              {step.state === "done" && <span className="sr-only"> (done)</span>}
              {step.count != null && step.count > 0 && <CountBadge count={step.count} blocking label={`${step.count} blocking items`} />}
            </span>
            {step.caption && <span className={cn("body-caption", MUTED)}>{step.caption}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

function EditAction() {
  const { model, editing, setEditing, go } = useProto();
  if (model.lockLevel === "Fully sent") return null;
  return (
    <Button
      variant="default"
      aria-pressed={editing}
      onClick={() => {
        setEditing(!editing);
        go("overview", "details");
      }}
    >
      <PencilSimpleIcon size={20} aria-hidden />
      Edit
    </Button>
  );
}

export function BatchHeader() {
  const { batch } = useProto();
  return (
    <div className="flex flex-col gap-20">
      <Link href={`/credit-batches?facility=${batch.facilityId}`} className={cn("inline-flex items-center gap-6 self-start body-small underline-offset-2 hover:underline", MUTED)}>
        <ArrowLeftIcon size={16} aria-hidden />
        All credit batches
      </Link>
      <div className="flex flex-col gap-24">
        <div className="flex flex-col gap-12">
        <PageHeader
          area="verification"
          title={batch.code}
          actions={
            <>
              <PrimaryAction />
              <EditAction />
              <OverflowMenu />
            </>
          }
        />
        <div className="flex flex-wrap items-center gap-12">
          {batch.feedstockTypeName && <Chip icon={<LeafIcon size={14} aria-hidden />}>{batch.feedstockTypeName}</Chip>}
          <span className={cn("body-small", MUTED)}>{formatDateRange(batch.startDate, batch.endDate)}</span>
        </div>
        </div>
        <ProgressSteps />
      </div>
    </div>
  );
}

/** Three figures an operator checks first. Open items live in their own tab badge and list. */
export function KeyNumbers() {
  const { model } = useProto();
  const { masses } = model;
  const cells = [
    {
      label: "Applied biochar",
      value: formatTonnes(model.appliedTons),
      sub: masses.notIn > 0 ? `${formatTonnes(masses.notIn)} not in a Removal` : "All in Removals",
    },
    { label: "Carbon estimate", value: `≈ ${formatTonnes(model.co2eTons ?? 0, { unit: "t CO₂e" })}`, sub: "Before project emissions" },
    {
      label: "Samples",
      value: `${model.samples} of ${SAMPLES_REQUIRED}`,
      sub: model.samples >= SAMPLES_REQUIRED ? "Enough for a sampled credit batch" : "A sampled credit batch needs three",
    },
  ];
  return (
    <dl className="grid grid-cols-1 border border-[var(--color-border-secondary)] bg-[var(--paper)] sm:grid-cols-3">
      {cells.map((cell) => (
        <div
          key={cell.label}
          className="flex items-baseline justify-between gap-12 border-t border-[var(--color-border-tertiary)] px-16 py-12 first:border-t-0 sm:flex-col sm:items-start sm:justify-start sm:gap-4 sm:border-t-0 sm:border-l sm:p-20 sm:first:border-l-0"
        >
          <dt className={cn("body-small", MUTED)}>{cell.label}</dt>
          <dd className="flex flex-col items-end gap-2 sm:items-start">
            <span className="title-heading-3 tabular-nums">{cell.value}</span>
            <span className={cn("body-caption", MUTED)}>{cell.sub}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
