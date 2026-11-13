import type { RemovalResendComparison } from "@/lib/certification/removal-resend-comparison";
import { pluralize } from "@/lib/copy-utils";
import { cn } from "@/lib/utils";
import { buildResendChangeRows } from "./resend-comparison-model";
import { BeforeAfterRow, MUTED } from "./review-parts";

/**
 * Review of a Removal sent again: each figure that differs from the version Isometric lost, as the
 * earlier value, an arrow and today's. Unchanged figures are not shown. An added or removed line
 * says so in words, never as zero.
 */
export function ResendComparisonGroup({
  comparison,
  componentName,
}: {
  comparison: RemovalResendComparison | null | undefined;
  componentName: (componentId: string) => string | undefined;
}) {
  if (!comparison) return null;
  const rows = buildResendChangeRows(comparison, componentName);
  const heading = `Compared with version ${comparison.previousVersion}`;
  if (!rows) {
    return (
      <section aria-labelledby="review-resend" className="flex flex-col gap-4">
        <h3 id="review-resend" className="body-lead font-medium">{heading}</h3>
        <p className={cn("body-small", MUTED)}>{`noma could not read the figures sent in version ${comparison.previousVersion}.`}</p>
      </section>
    );
  }
  return (
    <section aria-labelledby="review-resend" className="flex flex-col gap-16" data-resend-comparison="">
      <div className="flex flex-col gap-4">
        <h3 id="review-resend" className="body-lead font-medium">{heading}</h3>
        <p className={cn("body-small", MUTED)}>
          {rows.length === 0
            ? "The figures match the version Isometric lost."
            : `${rows.length} ${pluralize(rows.length, "figure differs", "figures differ")} from the version Isometric lost.`}
        </p>
      </div>
      {rows.length > 0 && (
        <ul className="flex flex-col gap-16">
          {rows.map((row) => (
            <li key={row.key} className="flex flex-col gap-8">
              <span className="body-medium text-[var(--color-text-primary)]">{row.label}</span>
              <BeforeAfterRow label={row.label} beforeLabel={`Version ${comparison.previousVersion}`} before={row.before} afterLabel="Now" after={row.after} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
