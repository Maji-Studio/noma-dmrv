/**
 * Derived ratios — the live H:C_org and O:C_org a sample's elemental figures
 * imply, shown as one line rather than two disabled inputs.
 *
 * H:C_org is never typed: it is always the atomic ratio of the hydrogen and
 * organic-carbon percentages entered above, so a read-only input for it invites
 * an edit that cannot happen. O:C_org accepts a lab value, and this line shows
 * whichever figure the eligibility check will actually use, so an operator can
 * see their entry take effect.
 *
 * The two figures are the block's headline, and Simple keeps the headline only.
 * Detailed adds the atomic formulas with this sample's own numbers behind
 * `Show calculation`, the same way the moisture split discloses its arithmetic.
 */
"use client";

import { CompositionCard } from "@/components/forms/composition-card";
import { DerivedHeadline } from "@/components/forms/derived-headline";
import { CertificationFieldTag } from "@/components/ui/certification-field-tag";
import type { CertFieldStatus } from "@/components/ui/certification-field-tag";
import { MISSING_VALUE } from "@/lib/copy-utils";

/** Molar masses, in the order the atomic ratios divide by them. */
const MOLAR_MASS = { hydrogen: 1.008, oxygen: 15.999, carbon: 12.011 } as const;
/** Four decimals, matching the precision the ratios are saved at. */
const RATIO_DECIMALS = 4;

function formatRatio(value: number | null): string {
  return value == null ? MISSING_VALUE.notRecorded : value.toFixed(RATIO_DECIMALS);
}

function DerivedRatio({ label, value, certifyRequired, certifyStatus }: {
  label: string;
  value: number | null;
  certifyRequired?: boolean;
  certifyStatus?: CertFieldStatus;
}) {
  return (
    <DerivedHeadline
      label={<>
        <span>{label}</span>
        {certifyRequired && <CertificationFieldTag status={certifyStatus} />}
      </>}
      value={value == null ? null : formatRatio(value)}
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
      simple="headline"
      headline={<>
        <div className="flex flex-wrap gap-x-32 gap-y-12">
          <DerivedRatio
            label="H:C org"
            value={hToCOrgRatio}
            certifyRequired={certifyRequired("hToCOrgRatio")}
            certifyStatus={certifyStatus("hToCOrgRatio")}
          />
          <DerivedRatio label="O:C org" value={oToCOrgRatio} />
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
