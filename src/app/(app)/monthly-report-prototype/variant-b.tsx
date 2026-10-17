/** PROTOTYPE variant B: one ledger table, grouped by section with subtotal rows. */
import type { ReactNode } from "react";
import { Notice, PageHeader, StatusBadge } from "@/components/ui";
import {
  APPLICATIONS, DELIVERIES, FEEDSTOCK_IN, RUNNING_RUN, batchRows, endDay, monthRuns, runYield, straddles, totals, unbatched,
} from "./fixture";
import { EmptyMonth, FLOOR_NOTE, Panel, ReportToolbar, RULES, energyText, fmtKg, fmtNum, fmtPct, fmtShort, missingText } from "./shared";

/* Desktop: label, detail, secondary figure, main figure. Phone: label over caption, main figure on the right. */
const ROW = "grid grid-cols-[minmax(0,1fr)_auto] gap-x-16 gap-y-2 px-16 py-10 md:grid-cols-[minmax(0,2.4fr)_minmax(0,1.6fr)_minmax(0,1.2fr)_minmax(0,1.2fr)] md:px-20";

function Head({ title, count, hint }: { title: string; count: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-2 border-t border-[var(--hair)] bg-[var(--sea)] px-16 py-10 md:px-20">
      <div className="flex items-baseline justify-between gap-12">
        <h2 className="body-medium font-medium">{title}</h2>
        <span className="body-small text-[var(--color-text-secondary)]">{count}</span>
      </div>
      {hint && <p className="body-caption text-[var(--color-text-tertiary)]">{hint}</p>}
    </div>
  );
}

function Line({ label, caption, detail, second, main, badge }: { label: string; caption?: ReactNode; detail?: ReactNode; second?: ReactNode; main: ReactNode; badge?: ReactNode }) {
  return (
    <div className={`${ROW} border-t border-[var(--row-divider)]`}>
      <div className="flex min-w-0 flex-col gap-2">
        <span className="body-small font-medium">{label}</span>
        {caption && <span className="body-caption text-[var(--color-text-tertiary)]">{caption}</span>}
      </div>
      <div className="hidden min-w-0 flex-col gap-2 md:flex">
        {detail && <span className="body-small text-[var(--color-text-secondary)]">{detail}</span>}
        {badge}
      </div>
      <div className="hidden body-small text-[var(--color-text-secondary)] md:block">{second}</div>
      <div className="body-small text-right font-medium tabular-nums">{main}</div>
    </div>
  );
}

function Subtotal({ label, main, second }: { label: string; main: ReactNode; second?: ReactNode }) {
  return (
    <div className={`${ROW} border-t border-[var(--hair-2)]`}>
      <span className="body-small font-medium md:col-span-2">{label}</span>
      <span className="hidden body-small text-[var(--color-text-secondary)] md:block">{second}</span>
      <span className="body-small text-right font-medium tabular-nums">{main}</span>
    </div>
  );
}

export function VariantB({ empty }: { empty: boolean }) {
  return (
    <div className="container-max page-shell">
      <PageHeader area="production" title="Monthly report" subtitle="One ledger for the month. Every line is a plain read of a record." />
      <ReportToolbar />
      {empty ? (
        <EmptyMonth />
      ) : (
        <>
          <Panel className="flex flex-col gap-6 px-16 py-12 md:px-20">
            <h2 className="body-small font-medium">Counting rules</h2>
            <ol className="flex list-decimal flex-col gap-4 pl-16">
              {RULES.map((r) => (
                <li key={r} className="body-caption text-[var(--color-text-secondary)]">{r}</li>
              ))}
            </ol>
          </Panel>

          <Panel className="overflow-hidden">
            <div className={`${ROW} hidden bg-[var(--sea)] md:grid`}>
              <span className="body-small font-medium text-[var(--color-text-secondary)]">Line</span>
              <span className="body-small font-medium text-[var(--color-text-secondary)]">Detail</span>
              <span className="body-small font-medium text-[var(--color-text-secondary)]">Feedstock used</span>
              <span className="body-small text-right font-medium text-[var(--color-text-secondary)]">Mass</span>
            </div>

            <Head title="1. Production runs" count={`${totals.runCount} runs`} hint="Counted in the month they ended." />
            {monthRuns.map((r) => (
              <Line
                key={r.code}
                label={r.code}
                caption={`${r.feedstock}, ${r.reactor}, yield ${fmtPct(runYield(r))}`}
                detail={straddles(r) ? `Ended ${fmtShort(endDay(r))}` : `Ended ${fmtShort(endDay(r))}`}
                badge={straddles(r) ? <span className="body-caption text-[var(--st-wait)]">Started Sep 30, counts in October</span> : undefined}
                second={fmtKg(r.feedstockKg)}
                main={fmtKg(r.biocharKg)}
              />
            ))}
            <Line label={RUNNING_RUN.code} caption="Started Oct 31, still running, not counted" detail="Not counted" main="Not available" />
            <Subtotal label={`Total, yield ${fmtPct(totals.yield)}`} second={fmtKg(totals.feedstockKg)} main={fmtKg(totals.biocharKg)} />

            <Head title="2. Feedstock received" count={`${FEEDSTOCK_IN.reduce((a, f) => a + f.deliveries, 0)} deliveries`} hint="By the delivery record date." />
            {FEEDSTOCK_IN.map((f) => (
              <Line key={f.type} label={f.type} detail={`${f.deliveries} deliveries`} main={fmtKg(f.kg)} />
            ))}
            <Subtotal label="Total received" main={fmtKg(totals.feedstockInKg)} />

            <Head title="3. Biochar deliveries" count={`${DELIVERIES.length} deliveries`} hint="By the delivery record date." />
            {DELIVERIES.map((d) => (
              <Line key={d.code} label={d.code} caption={d.customer} detail={fmtShort(d.date)} badge={<span><StatusBadge status={d.status} size="small" /></span>} main={fmtKg(d.kg)} />
            ))}
            <Subtotal label="Total delivered" main={fmtKg(totals.deliveredKg)} />

            <Head title="4. Biochar applications" count={`${APPLICATIONS.length} applications`} hint="By the application record date." />
            {APPLICATIONS.map((a) => (
              <Line key={a.code} label={a.code} caption={a.field} detail={fmtShort(a.date)} badge={<span><StatusBadge status={a.status} size="small" /></span>} main={fmtKg(a.kg)} />
            ))}
            <Subtotal label="Total applied" main={fmtKg(totals.appliedKg)} />

            <Head title="5. Credit batches ending in October" count={`${batchRows.length} batches`} hint="Energy is per batch, over every run inside the batch period. Main figure is diesel, second is grid electricity." />
            {batchRows.map(({ batch, energy, runs }) => (
              <div key={batch.code} className="border-t border-[var(--row-divider)]">
                <div className={`${ROW} border-0`}>
                  <div className="flex min-w-0 flex-col gap-2">
                    <span className="body-small font-medium">{batch.code}</span>
                    <span className="body-caption text-[var(--color-text-tertiary)]">{batch.feedstock}, {fmtShort(batch.periodStart)} to {fmtShort(batch.periodEnd)}, {runs.length} runs</span>
                  </div>
                  <div className="hidden min-w-0 flex-col items-start gap-2 md:flex">
                    <StatusBadge status={batch.state} size="small" />
                    <span className="body-caption text-[var(--color-text-tertiary)]">{batch.stateNote}</span>
                  </div>
                  <div className="hidden body-small text-[var(--color-text-secondary)] md:block">{energyText(energy.gridKwh, "kWh", energy.missingGrid)}</div>
                  <div className="body-small text-right font-medium tabular-nums">{energyText(energy.dieselL, "L", energy.missingDiesel)}</div>
                </div>
                <p className="px-16 pb-10 body-caption text-[var(--color-text-tertiary)] md:px-20">
                  <span className="md:hidden">{batch.state === "draft" ? "Draft" : batch.state === "pending" ? "Pending" : "Verified"}. Grid electricity {energyText(energy.gridKwh, "kWh", energy.missingGrid)}. </span>
                  {missingText(energy)}
                </p>
              </div>
            ))}
            <div className="border-t border-dashed border-[var(--color-border-secondary)]">
              <div className={ROW}>
                <div className="flex min-w-0 flex-col gap-2">
                  <span className="body-small font-medium">Unbatched</span>
                  <span className="body-caption text-[var(--color-text-tertiary)]">{unbatched.runs.length} runs in no credit batch: {unbatched.runs.map((r) => r.code).join(", ")}</span>
                </div>
                <div className="hidden md:block" />
                <div className="hidden body-small text-[var(--color-text-secondary)] md:block">{energyText(unbatched.energy.gridKwh, "kWh", unbatched.energy.missingGrid)}</div>
                <div className="body-small text-right font-medium tabular-nums">{energyText(unbatched.energy.dieselL, "L", unbatched.energy.missingDiesel)}</div>
              </div>
              <p className="px-16 pb-10 body-caption text-[var(--color-text-tertiary)] md:px-20">
                <span className="md:hidden">Grid electricity {energyText(unbatched.energy.gridKwh, "kWh", unbatched.energy.missingGrid)}. </span>
                {missingText(unbatched.energy)}
              </p>
            </div>
          </Panel>
          <Notice tone="warning">{FLOOR_NOTE} {fmtNum(totals.runCount)} runs counted this month.</Notice>
        </>
      )}
    </div>
  );
}
