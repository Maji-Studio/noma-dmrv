"use client";

/** PROTOTYPE (throwaway): page header, progress line and key numbers. */
import Link from "next/link";
import { ArrowLeftIcon, CheckIcon, DotsThreeIcon, LockSimpleIcon, LockSimpleOpenIcon } from "@phosphor-icons/react/dist/ssr";
import { PageHeader } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { formatDateRange, formatTonnes } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import { useProto } from "./prototype-context";
import { PROGRESS_STEPS, SAMPLES_REQUIRED } from "./prototype-model";

const MUTED = "text-[var(--color-text-secondary)]";

const LOCK_TEXT = {
  Open: "All fields editable",
  "Partly sent": "Some fields locked",
  "Fully sent": "All fields locked",
} as const;

function PrimaryAction() {
  const { model, go, say } = useProto();
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

/** The four lifecycle steps as one compact track. */
function ProgressSteps() {
  const { model } = useProto();
  const finished = model.progressIndex === PROGRESS_STEPS.length - 1;
  return (
    <ol className="grid w-full grid-cols-4 sm:max-w-[560px]" aria-label="Batch progress">
      {PROGRESS_STEPS.map((step, index) => {
        const done = index < model.progressIndex || (finished && index === model.progressIndex);
        const current = index === model.progressIndex && !done;
        return (
          <li key={step} aria-current={current ? "step" : undefined} className="flex min-w-0 flex-col gap-6">
            <span className="flex items-center" aria-hidden>
              <span
                className={cn(
                  "flex size-16 shrink-0 items-center justify-center rounded-full border",
                  done && "border-[var(--st-ok)] bg-[var(--st-ok)] text-white",
                  current && "border-[var(--ink)] bg-[var(--ink)]",
                  !done && !current && "border-[var(--color-border-secondary)] bg-[var(--paper)]",
                )}
              >
                {done && <CheckIcon size={9} weight="bold" />}
              </span>
              {index < PROGRESS_STEPS.length - 1 && <span className={cn("mx-6 h-px flex-1", done ? "bg-[var(--st-ok)]" : "bg-[var(--color-border-secondary)]")} />}
            </span>
            <span className={cn("body-caption pr-8", current ? "font-medium" : done ? "" : MUTED)}>
              {step}
              {done && <span className="sr-only"> (done)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function LockNote() {
  const { model } = useProto();
  const LockIcon = model.lockLevel === "Open" ? LockSimpleOpenIcon : LockSimpleIcon;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-6 body-caption", MUTED)}>
      <LockIcon size={14} aria-hidden />
      {LOCK_TEXT[model.lockLevel]}
    </span>
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
      <div className="flex flex-col gap-16">
        <PageHeader
          area="verification"
          title={batch.code}
          subtitle={[batch.feedstockTypeName, batch.facility?.name, formatDateRange(batch.startDate, batch.endDate)].filter(Boolean).join(", ")}
          actions={
            <>
              <PrimaryAction />
              <OverflowMenu />
            </>
          }
        />
        <div className="flex flex-col gap-12 sm:flex-row sm:items-end sm:justify-between sm:gap-24">
          <ProgressSteps />
          <LockNote />
        </div>
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
      label: "Biochar applied",
      value: formatTonnes(model.appliedTons),
      sub: masses.notIn > 0 ? `${formatTonnes(masses.notIn)} not in a Removal` : "All in Removals",
    },
    { label: "Carbon estimate", value: `≈ ${formatTonnes(model.co2eTons ?? 0, { unit: "t CO₂e" })}`, sub: "Before project emissions" },
    {
      label: "Lab samples",
      value: `${model.samples} of ${SAMPLES_REQUIRED}`,
      sub: model.samples >= SAMPLES_REQUIRED ? "Enough for Method B" : "Method B needs three",
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
