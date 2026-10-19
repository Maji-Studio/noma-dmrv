"use client";

/**
 * PROTOTYPE variant A: stat tiles, a rules panel, one table per group, credit
 * batches as cards. Three month states: empty, partial (in progress), full.
 * Phone: tables become stacked record cards.
 */
import type { ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { DataTable, Notice, PageHeader, StatCard, StatusBadge } from "@/components/ui";
import { endDay, runYield, startDay, type RunRecord } from "./fixture";
import { buildReport, monthLabelFor, type MonthState } from "./report";
import { EmptyMonth, Panel, ReportToolbar, RULES, energyText, fmtKg, fmtPct, fmtShort, missingCount } from "./shared";

type Report = ReturnType<typeof buildReport>;

const runCols: ColumnDef<RunRecord>[] = [
  { id: "run", header: "Run", cell: ({ row }) => row.original.code },
  { id: "reactor", header: "Reactor", cell: ({ row }) => row.original.reactor },
  { id: "started", header: "Started", cell: ({ row }) => fmtShort(startDay(row.original)) },
  { id: "ended", header: "Ended", cell: ({ row }) => fmtShort(endDay(row.original)) },
  { id: "feedstock", header: "Feedstock", cell: ({ row }) => row.original.feedstock },
  { id: "used", header: "Feedstock used", cell: ({ row }) => fmtKg(row.original.feedstockKg) },
  { id: "made", header: "Biochar made", cell: ({ row }) => fmtKg(row.original.biocharKg) },
  { id: "yield", header: "Yield", cell: ({ row }) => fmtPct(runYield(row.original)) },
  { id: "batch", header: "Credit batch", cell: ({ row }) => row.original.batchCode ?? "None yet" },
];

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-12">
      <div className="flex flex-col gap-4">
        <h2 className="title-heading-3">{title}</h2>
        {hint && <p className="body-small text-[var(--color-text-secondary)]">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

type Field = [label: string, value: ReactNode];

/** Phone only: one card per record, a heading line and a two column field grid. */
function RecordCards({ records }: { records: { key: string; title: string; trailing?: ReactNode; fields: Field[] }[] }) {
  return (
    <div className="flex flex-col gap-8 md:hidden">
      {records.map((r) => (
        <Panel key={r.key} className="flex flex-col gap-12 px-16 py-12">
          <div className="flex items-center justify-between gap-12">
            <span className="body-small font-medium">{r.title}</span>
            {r.trailing}
          </div>
          <dl className="grid grid-cols-3 gap-x-12 gap-y-8">
            {r.fields.map(([label, value]) => (
              <div key={label} className="flex min-w-0 flex-col gap-2">
                <dt className="body-caption text-[var(--color-text-tertiary)]">{label}</dt>
                <dd className="body-small tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      ))}
    </div>
  );
}

function Desktop({ children }: { children: ReactNode }) {
  return <div className="hidden md:block">{children}</div>;
}

function Tiles({ r, state }: { r: Report; state: "partial" | "full" }) {
  const when = state === "partial" ? "so far in October" : "in October";
  return (
    <div className="grid grid-cols-2 gap-8 md:gap-12 lg:grid-cols-4">
      <StatCard title="Production runs" value={String(r.runs.length)} description={`Ended ${when}`} />
      <StatCard title="Feedstock used" value={fmtKg(r.totals.feedstockKg)} description="By those runs" />
      <StatCard title="Biochar made" value={fmtKg(r.totals.biocharKg)} description="By those runs" />
      <StatCard title="Yield" value={fmtPct(r.totals.yield)} description="Biochar made over feedstock used" />
      <StatCard title="Feedstock received" value={fmtKg(r.totals.feedstockInKg)} description={`${r.totals.feedstockInCount} deliveries`} />
      <StatCard title="Biochar delivered" value={fmtKg(r.totals.deliveredKg)} description={`${r.deliveries.length} deliveries`} />
      <StatCard title="Biochar applied" value={fmtKg(r.totals.appliedKg)} description={`${r.applications.length} applications`} />
      <StatCard title="Credit batches" value={String(r.batches.length)} description={state === "partial" ? "Period has ended" : "Period ended in October"} />
    </div>
  );
}

function Rules() {
  return (
    <details className="group">
      <summary className="body-small cursor-pointer font-medium">How this month is counted</summary>
      <ul className="mt-8 flex flex-col gap-6">
        {RULES.map((rule) => (
          <li key={rule} className="body-small text-[var(--color-text-secondary)]">{rule}</li>
        ))}
      </ul>
    </details>
  );
}

function BatchCard({ title, status, fields, missing }: { title: string; status?: ReactNode; fields: Field[]; missing: string }) {
  return (
    <Panel className="flex flex-col gap-12 px-16 py-16 md:px-20">
      <div className="flex items-center justify-between gap-12">
        <h3 className="body-medium font-medium">{title}</h3>
        {status}
      </div>
      <dl className="grid grid-cols-2 gap-x-16 gap-y-12 min-[480px]:grid-cols-3">
        {fields.map(([label, value]) => (
          <div key={label} className="flex min-w-0 flex-col gap-2">
            <dt className="body-caption text-[var(--color-text-tertiary)]">{label}</dt>
            <dd className="body-small tabular-nums">{value}</dd>
          </div>
        ))}
        <div className="flex min-w-0 flex-col gap-2">
          <dt className="body-caption text-[var(--color-text-tertiary)]">Missing readings</dt>
          <dd className="body-small">{missing}</dd>
        </div>
      </dl>
    </Panel>
  );
}

const missingList = (d: number, g: number) =>
  [d && `${d} diesel`, g && `${g} grid`].filter(Boolean).join(", ") || "None";

function Report({ state }: { state: "partial" | "full" }) {
  const r = buildReport(state);
  const partial = state === "partial";
  const anyMissing = [...r.batches.map((b) => b.energy), r.unbatched.energy].some((e) => missingCount(e) > 0);
  return (
    <>
      {partial && (
        <Notice tone="info" title="October is not over">
          These figures are so far, up to {fmtShort(r.asOfDay)}, and change as records come in.
        </Notice>
      )}
      <Tiles r={r} state={state} />
      <Panel className="px-20 py-16">
        <Rules />
      </Panel>

      <Section
        title="Production runs"
        hint={partial ? `${r.runs.length} runs have ended so far.` : `${r.runs.length} runs ended in October.`}
      >
        {r.running.map((run) => (
          <Notice key={run.code} tone="info">
            {run.code} started {fmtShort(run.startedDay)} and has not ended. It counts in the month it ends.
          </Notice>
        ))}
        <RecordCards
          records={r.runs.map((x) => ({
            key: x.code,
            title: x.code,
            trailing: <span className="body-small tabular-nums">{fmtKg(x.biocharKg)}</span>,
            fields: [
              ["Started", fmtShort(startDay(x))],
              ["Ended", fmtShort(endDay(x))],
              ["Reactor", x.reactor],
              ["Feedstock", x.feedstock],
              ["Used", fmtKg(x.feedstockKg)],
              ["Yield", fmtPct(runYield(x))],
              ["Credit batch", x.batchCode ?? "None yet"],
            ],
          }))}
        />
        <Desktop><DataTable columns={runCols} data={r.runs} enableSorting={false} getRowId={(x) => x.code} /></Desktop>
      </Section>

      <Section title="Feedstock received">
        <RecordCards records={r.feedstockIn.map((f) => ({ key: f.type, title: f.type, fields: [["Deliveries", String(f.deliveries)], ["Mass received", fmtKg(f.kg)]] }))} />
        <Desktop>
          <DataTable
            enableSorting={false}
            data={r.feedstockIn}
            getRowId={(x) => x.type}
            columns={[
              { id: "t", header: "Feedstock", cell: ({ row }) => row.original.type },
              { id: "d", header: "Deliveries", cell: ({ row }) => String(row.original.deliveries) },
              { id: "k", header: "Mass received", cell: ({ row }) => fmtKg(row.original.kg) },
            ]}
          />
        </Desktop>
      </Section>

      <Section title="Biochar deliveries">
        <RecordCards
          records={r.deliveries.map((d) => ({
            key: d.code, title: d.customer, trailing: <StatusBadge status={d.status} />,
            fields: [["Date", fmtShort(d.date)], ["Mass", fmtKg(d.kg)]],
          }))}
        />
        <Desktop>
          <DataTable
            enableSorting={false}
            data={r.deliveries}
            getRowId={(x) => x.code}
            columns={[
              { id: "d", header: "Date", cell: ({ row }) => fmtShort(row.original.date) },
              { id: "u", header: "Customer", cell: ({ row }) => row.original.customer },
              { id: "k", header: "Mass", cell: ({ row }) => fmtKg(row.original.kg) },
              { id: "s", header: "Status", cell: ({ row }) => <StatusBadge status={row.original.status} /> },
            ]}
          />
        </Desktop>
      </Section>

      <Section title="Biochar applications">
        <RecordCards
          records={r.applications.map((a) => ({
            key: a.code, title: a.field, trailing: <StatusBadge status={a.status} />,
            fields: [["Date", fmtShort(a.date)], ["Mass", fmtKg(a.kg)]],
          }))}
        />
        <Desktop>
          <DataTable
            enableSorting={false}
            data={r.applications}
            getRowId={(x) => x.code}
            columns={[
              { id: "d", header: "Date", cell: ({ row }) => fmtShort(row.original.date) },
              { id: "f", header: "Field", cell: ({ row }) => row.original.field },
              { id: "k", header: "Mass", cell: ({ row }) => fmtKg(row.original.kg) },
              { id: "s", header: "Status", cell: ({ row }) => <StatusBadge status={row.original.status} /> },
            ]}
          />
        </Desktop>
      </Section>

      <Section
        title="Credit batches"
        hint={
          partial
            ? "Batches whose period has ended. Two more periods end later this month. Energy covers every run inside the period."
            : "Batches whose period ended in October. Energy covers every run inside the period, whichever month it ended."
        }
      >
        {r.batches.length === 0 ? (
          <Notice tone="info">No credit batch period has ended yet.</Notice>
        ) : (
          <div className="grid gap-12 lg:grid-cols-2">
            {r.batches.map(({ batch, energy, runs }) => (
              <BatchCard
                key={batch.code}
                title={batch.code}
                status={<StatusBadge status={batch.state} />}
                missing={missingList(energy.missingDiesel, energy.missingGrid)}
                fields={[
                  ["Feedstock", batch.feedstock],
                  ["Period", `${fmtShort(batch.periodStart)} to ${fmtShort(batch.periodEnd)}`],
                  ["Runs", String(runs.length)],
                  ["Diesel", energyText(energy.dieselL, "L", energy.missingDiesel)],
                  ["Grid electricity", energyText(energy.gridKwh, "kWh", energy.missingGrid)],
                ]}
              />
            ))}
            {r.unbatched.runs.length > 0 && (
              <BatchCard
                title="Not in a credit batch yet"
                missing={missingList(r.unbatched.energy.missingDiesel, r.unbatched.energy.missingGrid)}
                fields={[
                  ["Runs", r.unbatched.runs.map((x) => x.code).join(", ")],
                  ["Diesel", energyText(r.unbatched.energy.dieselL, "L", r.unbatched.energy.missingDiesel)],
                  ["Grid electricity", energyText(r.unbatched.energy.gridKwh, "kWh", r.unbatched.energy.missingGrid)],
                ]}
              />
            )}
          </div>
        )}
        {anyMissing && <Notice tone="warning">Energy totals skip missing readings, so they are a minimum.</Notice>}
      </Section>
    </>
  );
}

export function VariantA({ state }: { state: MonthState }) {
  return (
    <div className="container-max page-shell">
      <PageHeader area="production" title="Monthly report" subtitle="One facility's month at a glance, read from its records." />
      <ReportToolbar month={monthLabelFor(state)} />
      {state === "empty" ? <EmptyMonth month={monthLabelFor(state)} /> : <Report state={state} />}
    </div>
  );
}
