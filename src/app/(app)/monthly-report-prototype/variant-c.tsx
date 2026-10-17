/** PROTOTYPE variant C: a narrative month sheet, report style, close to a printable page. */
import type { ReactNode } from "react";
import { PageHeader, StatusBadge } from "@/components/ui";
import { PrinterIcon } from "@phosphor-icons/react/dist/ssr";
import {
  APPLICATIONS, DELIVERIES, FACILITY_NAME, FEEDSTOCK_IN, MONTH_LABEL, batchRows, endDay, monthRuns, runYield, straddles, totals, unbatched,
} from "./fixture";
import { EmptyMonth, ReportToolbar, RULES, energyText, fmtKg, fmtNum, fmtPct, fmtShort, missingText } from "./shared";

function B({ children }: { children: ReactNode }) {
  return <strong className="font-medium text-[var(--color-text-primary)] tabular-nums">{children}</strong>;
}

function Sheet({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-12 border-t border-[var(--hair)] pt-20">
      <h2 className="title-heading-3">
        <span className="mr-8 font-mono text-[var(--color-text-tertiary)]">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

const P = "body-medium text-[var(--color-text-secondary)]";
const TH = "py-6 pr-12 text-left body-caption font-medium text-[var(--color-text-tertiary)]";
const TD = "py-6 pr-12 body-small align-top";

export function VariantC({ empty }: { empty: boolean }) {
  return (
    <div className="container-max page-shell">
      <PageHeader area="production" title="Monthly report" subtitle="The month written out as a sheet you can read top to bottom." />
      <ReportToolbar />
      {empty ? (
        <EmptyMonth />
      ) : (
        <article className="mx-auto flex w-full max-w-[760px] flex-col gap-24 bg-[var(--panel-bg)] px-20 py-24 [border:var(--panel-border)] md:px-48 md:py-48">
          <header className="flex flex-col gap-8">
            <div className="flex items-center justify-between gap-12">
              <span className="label-micro text-[var(--color-text-tertiary)]">Monthly facility report</span>
              <PrinterIcon size={20} weight="bold" className="text-[var(--color-text-tertiary)]" aria-hidden />
            </div>
            <h1 className="title-heading-2">{FACILITY_NAME}, {MONTH_LABEL}</h1>
            <p className={P}>
              <B>{totals.runCount}</B> production runs ended this month. They used <B>{fmtKg(totals.feedstockKg)}</B> of feedstock
              and made <B>{fmtKg(totals.biocharKg)}</B> of biochar, a yield of <B>{fmtPct(totals.yield)}</B>.{" "}
              <B>{fmtKg(totals.deliveredKg)}</B> went out on {DELIVERIES.length} deliveries and <B>{fmtKg(totals.appliedKg)}</B> was applied
              on {APPLICATIONS.length} applications. {batchRows.length} credit batches closed.
            </p>
          </header>

          <Sheet n="1" title="Production runs">
            <p className={P}>
              {totals.runCount} runs ended in October. <B>{monthRuns.filter(straddles).map((r) => r.code).join(", ")}</B> started on
              Sep 30 and ended on Oct 1, so it counts fully in October and not at all in September. PR-26-0151 started on Oct 31 and
              is still running, so it is not counted.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-[var(--hair-2)]">
                    <th className={TH}>Run</th><th className={TH}>Ended</th><th className={`${TH} hidden md:table-cell`}>Feedstock</th>
                    <th className={`${TH} text-right`}>Used</th><th className={`${TH} text-right`}>Made</th><th className={`${TH} text-right pr-0`}>Yield</th>
                  </tr>
                </thead>
                <tbody>
                  {monthRuns.map((r) => (
                    <tr key={r.code} className="border-b border-[var(--row-divider)]">
                      <td className={`${TD} font-medium`}>{r.code}{straddles(r) ? <span className="text-[var(--st-wait)]"> *</span> : null}</td>
                      <td className={TD}>{fmtShort(endDay(r))}</td>
                      <td className={`${TD} hidden md:table-cell`}>{r.feedstock}</td>
                      <td className={`${TD} text-right tabular-nums`}>{fmtNum(r.feedstockKg)}</td>
                      <td className={`${TD} text-right tabular-nums`}>{fmtNum(r.biocharKg)}</td>
                      <td className={`${TD} text-right tabular-nums pr-0`}>{fmtPct(runYield(r))}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className={`${TD} font-medium`} colSpan={2}>Total (kg)</td><td className="hidden md:table-cell" />
                    <td className={`${TD} text-right font-medium tabular-nums`}>{fmtNum(totals.feedstockKg)}</td>
                    <td className={`${TD} text-right font-medium tabular-nums`}>{fmtNum(totals.biocharKg)}</td>
                    <td className={`${TD} text-right font-medium tabular-nums pr-0`}>{fmtPct(totals.yield)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Sheet>

          <Sheet n="2" title="Feedstock received">
            <p className={P}>
              {FEEDSTOCK_IN.map((f, i) => (
                <span key={f.type}>{i > 0 ? (i === FEEDSTOCK_IN.length - 1 ? ", and " : ", ") : ""}<B>{fmtKg(f.kg)}</B> of {f.type.toLowerCase()} on {f.deliveries} deliveries</span>
              ))}
              . That is <B>{fmtKg(totals.feedstockInKg)}</B> received, counted by delivery date.
            </p>
          </Sheet>

          <Sheet n="3" title="Biochar out">
            <p className={P}>Deliveries and applications count on their own record dates.</p>
            <ul className="flex flex-col">
              {DELIVERIES.map((d) => (
                <li key={d.code} className="flex items-baseline justify-between gap-12 border-b border-[var(--row-divider)] py-8">
                  <span className="body-small"><span className="font-medium">{d.code}</span>, {fmtShort(d.date)}, {d.customer}</span>
                  <span className="body-small tabular-nums">{fmtKg(d.kg)}</span>
                </li>
              ))}
              {APPLICATIONS.map((a) => (
                <li key={a.code} className="flex items-baseline justify-between gap-12 border-b border-[var(--row-divider)] py-8">
                  <span className="body-small"><span className="font-medium">{a.code}</span>, {fmtShort(a.date)}, {a.field} <StatusBadge status={a.status} size="small" /></span>
                  <span className="body-small tabular-nums">{fmtKg(a.kg)}</span>
                </li>
              ))}
            </ul>
          </Sheet>

          <Sheet n="4" title="Credit batches and energy">
            <p className={P}>
              {batchRows.length} credit batches have a period that ends in October. Energy is the recorded diesel and grid electricity of
              every run inside the batch period. Where a reading is missing the total is a floor.
            </p>
            {batchRows.map(({ batch, energy, runs }) => (
              <div key={batch.code} className="flex flex-col gap-4 border-l border-[var(--hair)] pl-16">
                <div className="flex flex-wrap items-center gap-8">
                  <span className="body-medium font-medium">{batch.code}</span>
                  <StatusBadge status={batch.state} size="small" />
                </div>
                <p className="body-small text-[var(--color-text-secondary)]">
                  {batch.feedstock}, {fmtShort(batch.periodStart)} to {fmtShort(batch.periodEnd)}, {runs.length} runs. {batch.stateNote}.
                </p>
                <p className="body-small">
                  <B>{energyText(energy.dieselL, "L", energy.missingDiesel)}</B> diesel. <B>{energyText(energy.gridKwh, "kWh", energy.missingGrid)}</B> grid electricity.{" "}
                  <span className="text-[var(--color-text-tertiary)]">{missingText(energy)}.</span>
                </p>
              </div>
            ))}
            <div className="flex flex-col gap-4 border-l border-dashed border-[var(--hair)] pl-16">
              <span className="body-medium font-medium">Unbatched</span>
              <p className="body-small text-[var(--color-text-secondary)]">{unbatched.runs.length} runs ended in October and sit in no credit batch yet: {unbatched.runs.map((r) => r.code).join(", ")}.</p>
              <p className="body-small">
                <B>{energyText(unbatched.energy.dieselL, "L", unbatched.energy.missingDiesel)}</B> diesel. <B>{energyText(unbatched.energy.gridKwh, "kWh", unbatched.energy.missingGrid)}</B> grid electricity.{" "}
                <span className="text-[var(--color-text-tertiary)]">{missingText(unbatched.energy)}.</span>
              </p>
            </div>
          </Sheet>

          <footer className="flex flex-col gap-6 border-t border-[var(--hair)] pt-16">
            <h2 className="body-small font-medium">How this month is counted</h2>
            <ol className="flex list-decimal flex-col gap-4 pl-16">
              {RULES.map((r) => <li key={r} className="body-caption text-[var(--color-text-secondary)]">{r}</li>)}
            </ol>
            <p className="body-caption text-[var(--st-wait)]">* Started in September, counted in October.</p>
          </footer>
        </article>
      )}
    </div>
  );
}
