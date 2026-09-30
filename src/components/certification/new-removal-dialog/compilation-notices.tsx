import { Notice } from "@/components/ui/notice";

interface CompilationBlockersProps {
  blockers: string[];
  showHeading?: boolean;
}

interface CompilationWarningsProps {
  warnings: string[];
  showEmpty?: boolean;
}

export function CompilationBlockers({
  blockers,
  showHeading = true,
}: CompilationBlockersProps) {
  if (blockers.length === 0) return null;

  return (
    <Notice tone="error" title={showHeading ? "Compilation blocked" : undefined}>
      <ul className="list-disc pl-16">
        {blockers.map((blocker) => (
          <li key={blocker}>{blocker}</li>
        ))}
      </ul>
    </Notice>
  );
}

export function CompilationWarnings({
  warnings,
  showEmpty = false,
}: CompilationWarningsProps) {
  if (warnings.length === 0) {
    return showEmpty ? (
      <p className="body-small text-[var(--color-text-tertiary)]">
        No omitted captured values.
      </p>
    ) : null;
  }

  return (
    <ul className="list-disc space-y-2 pl-16 body-small text-[var(--color-text-secondary)]">
      {warnings.map((warning) => (
        <li key={warning}>{warning}</li>
      ))}
    </ul>
  );
}
