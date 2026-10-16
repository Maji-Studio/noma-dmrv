"use client";

/**
 * The sheet or dialog header's requiredness legend: one ⓘ that tells the red asterisk
 * (blocks saving) from the CERT chip (blocks certification). It appears only
 * while the form shows CERT chips, in Simple and Detailed alike. Wording comes
 * from the asterisk's own text and the chip's own description, so it has one
 * source.
 */

import { InfoHint } from "@/components/ui/tooltip";
import { CERT_FIELD_STATUS_DESCRIPTION } from "@/components/ui/certification-field-tag";
import { REQUIRED_FIELD_TEXT } from "./form-field";
import { useHasCertFields } from "./requiredness-legend-context";

export const REQUIREDNESS_LEGEND_LABEL = "What the red asterisk and CERT chip mean";
export const ASTERISK_LEGEND = `${REQUIRED_FIELD_TEXT}. You cannot save until it is filled in.`;
export const CERT_CHIP_LEGEND = `${CERT_FIELD_STATUS_DESCRIPTION.neutral}. You can save without it.`;

export function RequirednessLegendHint() {
  if (!useHasCertFields()) return null;
  return (
    <InfoHint side="bottom" label={REQUIREDNESS_LEGEND_LABEL}>
      <span className="flex flex-col gap-6">
        <span>
          <strong className="font-medium">Red asterisk:</strong> {ASTERISK_LEGEND}
        </span>
        {/* The space keeps the two lines apart in the trigger's plain-text
            description, which joins child nodes without one. */}
        {" "}
        <span>
          <strong className="font-medium">CERT chip:</strong> {CERT_CHIP_LEGEND}
        </span>
      </span>
    </InfoHint>
  );
}
