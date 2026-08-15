"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr";
import type { RemovalCompilationView } from "@/fn/certification";
import type { RemovalLedgerPreview } from "@/fn/certification/removal-ledger-preview";
import { creditBatchDeepLinkHref } from "@/lib/credit-batch-links";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { formatTonnes } from "@/lib/format-utils";

const LINK_ICON_SIZE = 12;

function inputValue(input: RemovalLedgerPreview["inputs"][number]): string {
  return input.magnitude == null
    ? MISSING_VALUE.notAvailable
    : `${input.magnitude.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${input.unit}`.trim();
}

function LedgerLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-4 underline-offset-4 hover:text-[var(--color-interaction)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
    >
      {children}
      <ArrowSquareOutIcon size={LINK_ICON_SIZE} aria-hidden />
    </Link>
  );
}

interface RemovalEmissionsLedgerProps {
  compilation: RemovalCompilationView | null;
  ledger: RemovalLedgerPreview;
  facilityId: string;
  isLoading: boolean;
}

export function RemovalEmissionsLedger({
  compilation,
  ledger,
  facilityId,
  isLoading,
}: RemovalEmissionsLedgerProps) {
  if (isLoading) {
    return (
      <section className="border border-[var(--color-border-primary)] px-20 py-16">
        <p className="body-small text-[var(--color-text-tertiary)]">
          Preparing the carbon ledger…
        </p>
      </section>
    );
  }
  if (!compilation) return null;

  const estimate = compilation.estimatedStoredCo2eTonnes;
  const claims = ledger.claims;
  const productionAndDeliveryCount = claims.filter(
    (claim) => claim.contribution === "production-and-delivery",
  ).length;
  const deliveryOnlyCount = claims.length - productionAndDeliveryCount;
  const showAllocation =
    claims.length > 1 &&
    productionAndDeliveryCount > 0 &&
    deliveryOnlyCount > 0;

  return (
    <section
      className="border border-[var(--color-border-primary)] bg-[var(--color-background-white)]"
      aria-labelledby="removal-carbon-ledger-title"
    >
      <div className="flex flex-col gap-4 px-20 py-16">
        <h3 id="removal-carbon-ledger-title" className="body-medium font-medium">
          Carbon ledger
        </h3>
        <p className="title-heading-2 tabular-nums text-[var(--color-text-primary)]">
          {estimate == null
            ? MISSING_VALUE.notAvailable
            : `≈ ${formatTonnes(estimate, { unit: "t CO₂e" })}`}
        </p>
        <p className="body-caption text-[var(--color-text-tertiary)]">
          Estimated CO₂e stored before project emissions and registry verification.
          Isometric calculates the final net value.
        </p>
      </div>

      {showAllocation && (
        <div className="border-t border-[var(--color-border-tertiary)] px-20 py-12">
          <p className="mb-8 body-small font-medium text-[var(--color-text-primary)]">
            Emission allocation
          </p>
          <div
            className="flex h-8 overflow-hidden bg-[var(--color-surface-medium)]"
            aria-hidden
          >
            <span
              className="bg-[var(--st-ok)]"
              style={{
                width: `${(productionAndDeliveryCount / claims.length) * 100}%`,
              }}
            />
            <span
              className="bg-[var(--color-text-tertiary)]"
              style={{ width: `${(deliveryOnlyCount / claims.length) * 100}%` }}
            />
          </div>
          <div className="mt-8 flex flex-wrap gap-x-16 gap-y-4 body-caption text-[var(--color-text-tertiary)]">
            <span>{productionAndDeliveryCount} with production and delivery</span>
            <span>{deliveryOnlyCount} delivery only</span>
          </div>
        </div>
      )}

      <div className="border-t border-[var(--color-border-tertiary)] px-20 py-12">
        <p className="body-small font-medium text-[var(--color-text-primary)]">
          Inputs included
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-left body-caption">
          <thead className="text-[var(--color-text-tertiary)]">
            <tr className="border-t border-[var(--color-border-tertiary)]">
              <th className="px-20 py-8 font-normal">Component</th>
              <th className="px-12 py-8 font-normal">Input</th>
              <th className="px-20 py-8 text-right font-normal">Value</th>
            </tr>
          </thead>
          <tbody>
            {ledger.inputs.map((input) => (
              <tr
                key={input.id}
                className="border-t border-[var(--color-border-tertiary)]"
              >
                <td className="px-20 py-8 text-[var(--color-text-secondary)]">
                  {input.component}
                </td>
                <td className="px-12 py-8 text-[var(--color-text-primary)]">
                  {input.input}
                </td>
                <td className="px-20 py-8 text-right font-mono tabular-nums text-[var(--color-text-primary)]">
                  {inputValue(input)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {claims.length > 0 && (
        <dl className="border-t border-[var(--color-border-primary)]">
          {claims.map((claim) => (
            <div
              key={claim.creditBatchId}
              className="flex items-baseline justify-between gap-12 border-t border-[var(--color-border-tertiary)] px-20 py-8 first:border-t-0"
            >
              <dt className="body-small text-[var(--color-text-secondary)]">
                {claim.creditBatchCode} production emissions
              </dt>
              <dd className="body-small text-right text-[var(--color-text-primary)]">
                {claim.contribution === "delivery-only" && claim.claimingRemovalId ? (
                  <LedgerLink
                    href={`/certification/removals?facility=${encodeURIComponent(facilityId)}&removal=${encodeURIComponent(claim.claimingRemovalId)}`}
                  >
                    Previously included in Removal {claim.claimingRemovalId.slice(0, 8)}…
                  </LedgerLink>
                ) : (
                  "Included in this Removal"
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <div className="border-t border-[var(--color-border-primary)] px-20 py-12">
        <p className="mb-8 body-small font-medium text-[var(--color-text-primary)]">
          Source records
        </p>
        <ul className="flex flex-col gap-6 body-caption text-[var(--color-text-secondary)]">
          {ledger.creditBatches.map((batch) => (
            <li key={batch.id} className="flex items-baseline justify-between gap-12">
              <span>Credit batch</span>
              <LedgerLink href={creditBatchDeepLinkHref(batch.id, facilityId)}>
                {batch.code}
              </LedgerLink>
            </li>
          ))}
          {ledger.productionRuns.map((run) => (
            <li key={run.id} className="flex items-baseline justify-between gap-12">
              <span>Production run</span>
              <LedgerLink
                href={`/production-runs?facility=${encodeURIComponent(facilityId)}&run=${encodeURIComponent(run.id)}`}
              >
                {run.code ?? "Open run"}
              </LedgerLink>
            </li>
          ))}
          {ledger.applications.map((application) => (
            <li
              key={application.id}
              className="flex items-baseline justify-between gap-12"
            >
              <span>{application.deliveryCode} · application</span>
              <LedgerLink
                href={`/traceability?batch=${encodeURIComponent(ledger.creditBatches[0]?.id ?? "")}&application=${encodeURIComponent(application.id)}`}
              >
                {application.code}
              </LedgerLink>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
