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
    <div className="border-l-2 border-[var(--st-bad)] pl-12" role="alert">
      {showHeading && (
        <p className="body-small font-medium text-[var(--color-text-primary)]">
          Compilation blocked
        </p>
      )}
      <ul
        className={
          showHeading
            ? "mt-4 list-disc pl-16 body-small text-[var(--color-text-secondary)]"
            : "list-disc pl-16 body-small text-[var(--color-text-secondary)]"
        }
      >
        {blockers.map((blocker) => (
          <li key={blocker}>{blocker}</li>
        ))}
      </ul>
    </div>
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
