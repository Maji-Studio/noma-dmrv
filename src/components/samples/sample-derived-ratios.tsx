/**
 * Derived ratios — the live H:C_org and O:C_org a sample's elemental figures
 * imply, shown as one line rather than two disabled inputs.
 *
 * H:C_org is never typed: it is always the atomic ratio of the hydrogen and
 * organic-carbon percentages entered above, so a read-only input for it invites
 * an edit that cannot happen. O:C_org is calculated whenever oxygen is
 * entered and takes the lab value only without oxygen; this line shows the
 * figure that will be saved, so an operator can see which one applies.
 *
 * The two figures are the block's headline, shown at both levels. Detailed
 * adds the atomic formulas with this sample's own numbers behind
 * `Show calculation`, the same way the moisture split discloses its arithmetic.
 */
"use client";

import { CompositionCard } from "@/components/forms/composition-card";
import { DerivedHeadline } from "@/components/forms/derived-headline";
import { CertificationFieldTag } from "@/components/ui/certification-field-tag";
import type { CertFieldStatus } from "@/components/ui/certification-field-tag";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { formatSampleRatio, SAMPLE_RATIO_MOLAR_MASS as MOLAR_MASS } from "@/lib/calculations/sample-ratios";

function formatRatio(value: number | null): string {
  return value == null ? MISSING_VALUE.notRecorded : formatSampleRatio(value);
}

/** Why a ratio has no figure: the entries it is calculated from that are still empty. */
function ratioGap(numeratorPercent: number | null, numeratorName: string, organicCarbonPercent: number | null): string | null {
  const missing = [
    numeratorPercent == null ? numeratorName : null,
    organicCarbonPercent == null || organicCarbonPercent === 0 ? "organic carbon" : null,
  ].filter((name): name is string => name !== null);
  return missing.length > 0 ? `Needs ${missing.join(" and ")}` : null;
}

/** O:C org also takes the lab ratio entered above, so its reason offers that too. */
function withLabRatio(gap: string | null): string | null {
  return gap ? `${gap}, or the O:C org ratio` : null;
}

function DerivedRatio({ label, value, gap, certifyRequired, certifyStatus }: {
  label: string;
  value: number | null;
  /** Why there is no figure, when the empty inputs say so. */
  gap: string | null;
  certifyRequired?: boolean;
  certifyStatus?: CertFieldStatus;
}) {
  return (
    <DerivedHeadline
      label={<span className="flex min-h-24 items-center gap-8">
        <span>{label}</span>
        {certifyRequired && <CertificationFieldTag status={certifyStatus} />}
      </span>}
      value={value == null ? null : formatRatio(value)}
      sub={value == null ? gap ?? undefined : undefined}
    />
  );
}

function formatAtomicRatio(numeratorPercent: number | null, numeratorMass: number, organicCarbonPercent: number | null): string {
  if (numeratorPercent == null || organicCarbonPercent == null || organicCarbonPercent === 0) return MISSING_VALUE.notRecorded;
  return `(${numeratorPercent} / ${numeratorMass}) / (${organicCarbonPercent} / ${MOLAR_MASS.carbon})`;
}

export function SampleDerivedRatios({
  hToCOrgRatio,
  oToCOrgRatio,
  hydrogenPercent,
  oxygenPercent,
  organicCarbonPercent,
  oToCFromLab,
  error,
  certifyRequired,
  certifyStatus,
}: {
  hToCOrgRatio: number | null;
  /** The figure the eligibility check uses: the lab entry when there is one. */
  oToCOrgRatio: number | null;
  hydrogenPercent: number | null;
  oxygenPercent: number | null;
  organicCarbonPercent: number | null;
  /** Whether O:C_org came from the lab field rather than from oxygen and carbon. */
  oToCFromLab: boolean;
  /**
   * A derived ratio can still be refused: the numeric(7,6) cap is re-checked
   * after the resolver runs, and with no input to attach it to the refusal
   * belongs on the figure it refuses.
   */
  error?: string;
  certifyRequired: (field: string) => boolean;
  certifyStatus: (field: string) => CertFieldStatus;
}) {
  return (
    <CompositionCard
      title="Derived ratios"
      headline={<>
        {/* Every label row is min-h-24, so the CERT tag on H:C does not push
            its figure below O:C's and both labels share a baseline. */}
        <div className="flex flex-wrap items-start gap-x-32 gap-y-12">
          <DerivedRatio
            label="H:C org"
            value={hToCOrgRatio}
            gap={ratioGap(hydrogenPercent, "hydrogen", organicCarbonPercent)}
            certifyRequired={certifyRequired("hToCOrgRatio")}
            certifyStatus={certifyStatus("hToCOrgRatio")}
          />
          <DerivedRatio
            label="O:C org"
            value={oToCOrgRatio}
            gap={oToCFromLab ? "Needs the O:C org ratio" : withLabRatio(ratioGap(oxygenPercent, "oxygen", organicCarbonPercent))}
          />
        </div>
        {error && <p role="alert" className="body-caption text-[var(--st-bad)]">{error}</p>}
      </>}
      calculation={(
        <dl className="space-y-8 body-caption text-[var(--color-text-secondary)]">
          <div>
            <dt>H:C org is the atomic ratio of hydrogen to organic carbon.</dt>
            <dd className="tabular-nums">
              {formatAtomicRatio(hydrogenPercent, MOLAR_MASS.hydrogen, organicCarbonPercent)} = {formatRatio(hToCOrgRatio)}
            </dd>
          </div>
          <div>
            <dt>
              {oToCFromLab
                ? "O:C org comes from the lab ratio entered above."
                : "O:C org is the atomic ratio of oxygen to organic carbon."}
            </dt>
            <dd className="tabular-nums">
              {oToCFromLab
                ? formatRatio(oToCOrgRatio)
                : `${formatAtomicRatio(oxygenPercent, MOLAR_MASS.oxygen, organicCarbonPercent)} = ${formatRatio(oToCOrgRatio)}`}
            </dd>
          </div>
        </dl>
      )}
    />
  );
}
