"use client";

/** PROTOTYPE variant A: stat tiles at the top, then one section per record group. */
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, PageHeader, StatCard, StatusBadge, Notice } from "@/components/ui";
import {
  APPLICATIONS, BATCHES, DELIVERIES, FEEDSTOCK_IN, batchRows, endDay, monthRuns, runYield,
  straddles, totals, unbatched, type RunRecord,
} from "./fixture";
import { EmptyMonth, FLOOR_NOTE, Panel, ReportToolbar, RULES, energyText, fmtKg, fmtNum, fmtPct, fmtShort, missingCount, missingText } from "./shared";

const runCols: ColumnDef<RunRecord>[] = [
  {
    id: "run", header: "Run",
    cell: ({ row: { original: r } }) => (
      <div className="flex flex-col">
        <span className="body-small font-medium">{r.code}</span>
        {straddles(r) && (
          <span className="body-caption text-[var(--st-wait)]">Started {fmtShort(r.startedAt.slice(0, 10))}, counts in October</span>
        )}
      </div>
    ),
  },
  { id: "reactor", header: "Reactor", cell: ({ row }) => row.original.reactor },
  { id: "ended", header: "Ended", cell: ({ row }) => fmtShort(endDay(row.original)) },
  { id: "feedstock", header: "Feedstock", cell: ({ row }) => row.original.feedstock },
  { id: "used", header: "Feedstock used", cell: ({ row }) => fmtKg(row.original.feedstockKg) },
  { id: "made", header: "Biochar made", cell: ({ row }) => fmtKg(row.original.biocharKg) },
  { id: "yield", header: "Yield", cell: ({ row }) => fmtPct(runYield(row.original)) },
  { id: "batch", header: "Credit batch", cell: ({ row }) => row.original.batchCode ?? "Unbatched" },
];

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
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

function MobileList({ rows }: { rows: { key: string; title: string; caption: string; value: string }[] }) {
  return (
    <Panel className="md:hidden">
      {rows.map((r, i) => (
        <div key={r.key} className={`flex items-start justify-between gap-12 px-16 py-10 ${i > 0 ? "border-t border-[var(--row-divider)]" : ""}`}>
          <div className="flex min-w-0 flex-col gap-2">
            <span className="body-small font-medium">{r.title}</span>
            <span className="body-caption text-[var(--color-text-tertiary)]">{r.caption}</span>
          </div>
          <span className="body-small whitespace-nowrap tabular-nums">{r.value}</span>
        </div>
      ))}
    </Panel>
  );
}

function Cell({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="body-caption text-[var(--color-text-tertiary)]">{label}</span>
      <span className="body-medium font-medium">{value}</span>
      {note && <span className="body-caption text-[var(--color-text-tertiary)]">{note}</span>}
    </div>
  );
}

export function VariantA({ empty }: { empty: boolean }) {
  return (
    <div className="container-max page-shell">
      <PageHeader area="production" title="Monthly report" subtitle="One facility's month at a glance, read straight from its records." />
      <ReportToolbar />
      {empty ? (
        <EmptyMonth />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-12 lg:grid-cols-4">
            <StatCard title="Production runs" value={String(totals.runCount)} description="Ended in October" />
            <StatCard title="Feedstock used" value={fmtKg(totals.feedstockKg)} description="By those runs" />
            <StatCard title="Biochar made" value={fmtKg(totals.biocharKg)} description="By those runs" />
            <StatCard title="Yield" value={fmtPct(totals.yield)} description="Biochar made over feedstock used" />
            <StatCard title="Feedstock received" value={fmtKg(totals.feedstockInKg)} description="9 deliveries" />
            <StatCard title="Biochar delivered" value={fmtKg(totals.deliveredKg)} description="4 deliveries" />
            <StatCard title="Biochar applied" value={fmtKg(totals.appliedKg)} description="3 applications" />
            <StatCard title="Credit batches" value={String(BATCHES.length)} description="Period ends in October" />
          </div>

          <Panel className="flex flex-col gap-8 px-20 py-16">
            <h2 className="body-small font-medium">How this month is counted</h2>
            <ul className="flex flex-col gap-6">
              {RULES.map((rule) => (
                <li key={rule} className="body-small text-[var(--color-text-secondary)]">{rule}</li>
              ))}
            </ul>
          </Panel>

          <Section title="Production runs" hint={`${monthRuns.length} runs ended in October. PR-26-0151 started Oct 31 and is still running, so it is not counted.`}>
            <MobileList rows={monthRuns.map((r) => ({ key: r.code, title: r.code, caption: `${r.feedstock}, ended ${fmtShort(endDay(r))}, yield ${fmtPct(runYield(r))}${straddles(r) ? ". Started Sep 30, counts in October" : ""}`, value: fmtKg(r.biocharKg) }))} />
            <div className="hidden md:block"><DataTable columns={runCols} data={monthRuns} enableSorting={false} getRowId={(r) => r.code} /></div>
          </Section>

          <Section title="Feedstock received">
            <MobileList rows={FEEDSTOCK_IN.map((f) => ({ key: f.type, title: f.type, caption: `${f.deliveries} deliveries`, value: fmtKg(f.kg) }))} />
            <div className="hidden md:block"><DataTable
              enableSorting={false}
              data={FEEDSTOCK_IN}
              getRowId={(r) => r.type}
              columns={[
                { id: "t", header: "Feedstock type", cell: ({ row }) => row.original.type },
                { id: "d", header: "Deliveries", cell: ({ row }) => String(row.original.deliveries) },
                { id: "k", header: "Mass received", cell: ({ row }) => fmtKg(row.original.kg) },
              ]}
            /></div>
          </Section>

          <Section title="Biochar deliveries">
            <MobileList rows={DELIVERIES.map((d) => ({ key: d.code, title: d.code, caption: `${fmtShort(d.date)}, ${d.customer}`, value: fmtKg(d.kg) }))} />
            <div className="hidden md:block"><DataTable
              enableSorting={false}
              data={DELIVERIES}
              getRowId={(r) => r.code}
              columns={[
                { id: "c", header: "Delivery", cell: ({ row }) => row.original.code },
                { id: "d", header: "Date", cell: ({ row }) => fmtShort(row.original.date) },
                { id: "u", header: "Customer", cell: ({ row }) => row.original.customer },
                { id: "k", header: "Mass", cell: ({ row }) => fmtKg(row.original.kg) },
                { id: "s", header: "Status", cell: ({ row }) => <StatusBadge status={row.original.status} /> },
              ]}
            /></div>
          </Section>

          <Section title="Biochar applications">
            <MobileList rows={APPLICATIONS.map((d) => ({ key: d.code, title: d.code, caption: `${fmtShort(d.date)}, ${d.field}`, value: fmtKg(d.kg) }))} />
            <div className="hidden md:block"><DataTable
              enableSorting={false}
              data={APPLICATIONS}
              getRowId={(r) => r.code}
              columns={[
                { id: "c", header: "Application", cell: ({ row }) => row.original.code },
                { id: "d", header: "Date", cell: ({ row }) => fmtShort(row.original.date) },
                { id: "f", header: "Field", cell: ({ row }) => row.original.field },
                { id: "k", header: "Mass", cell: ({ row }) => fmtKg(row.original.kg) },
                { id: "s", header: "Status", cell: ({ row }) => <StatusBadge status={row.original.status} /> },
              ]}
            /></div>
          </Section>

          <Section title="Credit batches ending in October" hint="Energy is the recorded diesel and grid electricity of every run inside the batch period, whichever month the run ended.">
            <div className="grid gap-12 lg:grid-cols-2">
              {batchRows.map(({ batch, energy, runs, monthRunCount }) => (
                <Panel key={batch.code} className="flex flex-col gap-16 px-20 py-16">
                  <div className="flex items-start justify-between gap-12">
                    <div className="flex flex-col gap-2">
                      <span className="body-medium font-medium">{batch.code}</span>
                      <span className="body-caption text-[var(--color-text-tertiary)]">
                        {batch.feedstock}, {fmtShort(batch.periodStart)} to {fmtShort(batch.periodEnd)}
                      </span>
                    </div>
                    <StatusBadge status={batch.state} />
                  </div>
                  <p className="body-caption text-[var(--color-text-secondary)]">{batch.stateNote}</p>
                  <div className="grid grid-cols-3 gap-12">
                    <Cell label="Diesel" value={energyText(energy.dieselL, "L", energy.missingDiesel)} />
                    <Cell label="Grid electricity" value={energyText(energy.gridKwh, "kWh", energy.missingGrid)} />
                    <Cell label="Runs in batch" value={String(runs.length)} note={`${monthRunCount} ended in October`} />
                  </div>
                  <p className={`body-caption ${missingCount(energy) ? "text-[var(--st-wait)]" : "text-[var(--color-text-tertiary)]"}`}>
                    {missingText(energy)}
                  </p>
                </Panel>
              ))}
              <Panel className="flex flex-col gap-16 border-dashed px-20 py-16">
                <div className="flex flex-col gap-2">
                  <span className="body-medium font-medium">Unbatched</span>
                  <span className="body-caption text-[var(--color-text-tertiary)]">
                    {unbatched.runs.length} runs ended in October and are in no credit batch yet: {unbatched.runs.map((r) => r.code).join(", ")}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-12">
                  <Cell label="Diesel" value={energyText(unbatched.energy.dieselL, "L", unbatched.energy.missingDiesel)} />
                  <Cell label="Grid electricity" value={energyText(unbatched.energy.gridKwh, "kWh", unbatched.energy.missingGrid)} />
                  <Cell label="Runs" value={fmtNum(unbatched.runs.length)} />
                </div>
                <p className="body-caption text-[var(--st-wait)]">{missingText(unbatched.energy)}</p>
              </Panel>
            </div>
            <Notice tone="warning">{FLOOR_NOTE}</Notice>
          </Section>
        </>
      )}
    </div>
  );
}
