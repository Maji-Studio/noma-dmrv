import type { EntityCertifyReadiness } from "@/lib/certification/entity-readiness";

interface EntityCertifyReadinessBadgeProps {
  readiness: EntityCertifyReadiness;
}

export function EntityCertifyReadinessBadge({
  readiness,
}: EntityCertifyReadinessBadgeProps) {
  const ready = readiness.state === "ready";
  const label = ready
    ? "Certifier-ready"
    : `Incomplete (${readiness.gaps.length})`;

  return (
    <span
      aria-label={
        ready
          ? "Certifier-ready"
          : `Incomplete for certification with ${readiness.gaps.length} gap${
              readiness.gaps.length === 1 ? "" : "s"
            }`
      }
      className={[
        "inline-flex h-24 items-center border px-8 body-caption font-medium uppercase",
        ready
          ? "border-[var(--color-signal-green)] text-[var(--color-signal-green)]"
          : "border-[var(--color-signal-orange)] text-[var(--color-signal-orange)]",
      ].join(" ")}
    >
      {label}
    </span>
  );
}
