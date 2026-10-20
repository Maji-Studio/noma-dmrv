/**
 * A Removal template's lines laid out like Isometric's template page, so the
 * two can be held side by side: the Mitigated section, then Emitted, each with
 * its line count; inside them the template's groups in Isometric's order with
 * their counts ("Pyrolysis (3)"); lines by their Isometric names, A to Z.
 * noma's decision for each line sits on its row (`renderLine`).
 */
import type { ReactNode } from "react";
import {
  countedLabel,
  SECTION_LABELS,
  sectionTemplateLines,
  type RemovalTemplateReviewLine,
} from "./removal-template-review-model";

export interface RemovalTemplateLineSectionsProps {
  lines: readonly RemovalTemplateReviewLine[];
  /** Unique per card, so two cards never share heading ids. */
  idPrefix: string;
  renderLine: (line: RemovalTemplateReviewLine) => ReactNode;
}

export function RemovalTemplateLineSections({ lines, idPrefix, renderLine }: RemovalTemplateLineSectionsProps) {
  return (
    <div className="flex flex-col gap-20">
      {sectionTemplateLines(lines).map((section) => {
        const headingId = `${idPrefix}-${section.section}`;
        return (
          <section key={section.section} aria-labelledby={headingId} className="flex flex-col gap-12">
            <h4
              id={headingId}
              className="bg-[var(--color-surface-light)] px-12 py-8 body-small font-medium text-[var(--color-text-primary)]"
            >
              {countedLabel(SECTION_LABELS[section.section], section.lineCount)}
            </h4>
            {section.groups.map((group) => (
              <section key={group.key} aria-label={group.name} className="flex flex-col gap-8">
                <h5 className="px-12 body-small font-medium text-[var(--color-text-secondary)]">
                  {countedLabel(group.name, group.lineCount)}
                </h5>
                <ul className="flex flex-col divide-y divide-[var(--color-border-tertiary)] border-y border-[var(--color-border-tertiary)]">
                  {group.lines.map((line) => renderLine(line))}
                </ul>
              </section>
            ))}
          </section>
        );
      })}
    </div>
  );
}
