/**
 * PageHeader — canonical list-page header (visual design plan, Phase 2).
 *
 * Shell: mono uppercase area eyebrow → title-heading-2 title → one-line
 * subtitle → actions slot. The eyebrow names the sidebar nav area the page
 * belongs to and is tinted with that area's accent ink (text-on-light safe).
 */
import * as React from "react";
import { cn } from "@/lib/utils";

type PageArea =
  | "production"
  | "infrastructure"
  | "distribution"
  | "verification"
  | "certification";

// Eyebrow label + accent-ink class per sidebar nav area. Verification and
// certification read pink in the sidebar, so both share the pink-family ink.
const AREA_META: Record<PageArea, { label: string; inkClass: string }> = {
  production: { label: "Production", inkClass: "text-[var(--acc-prod-ink)]" },
  infrastructure: { label: "Infrastructure", inkClass: "text-[var(--acc-infra-ink)]" },
  distribution: { label: "Distribution", inkClass: "text-[var(--acc-dist-ink)]" },
  verification: { label: "Verification", inkClass: "text-[var(--acc-dist-ink)]" },
  certification: { label: "Certification", inkClass: "text-[var(--acc-dist-ink)]" },
};

interface PageHeaderProps {
  /** Sidebar nav area — sets the eyebrow text and its accent ink. */
  area?: PageArea;
  /** Override the eyebrow text (defaults to the area label). */
  eyebrow?: string;
  title: string;
  /** One-line page description — every list page should have one. */
  subtitle?: string;
  /** Right-aligned slot, typically the New Entity button. */
  actions?: React.ReactNode;
  className?: string;
}

function PageHeader({
  area,
  eyebrow,
  title,
  subtitle,
  actions,
  className,
}: PageHeaderProps) {
  const meta = area ? AREA_META[area] : undefined;
  const eyebrowText = eyebrow ?? meta?.label;

  return (
    <header className={cn("flex items-center justify-between gap-24", className)}>
      <div className="flex min-w-0 flex-col gap-4">
        {eyebrowText && (
          <p
            className={cn(
              "title-chapter-title",
              meta?.inkClass ?? "text-[var(--color-text-tertiary)]"
            )}
          >
            {eyebrowText}
          </p>
        )}
        <h1 className="title-heading-2">{title}</h1>
        {subtitle && (
          <p className="body-small text-[var(--color-text-secondary)]">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-12">{actions}</div>}
    </header>
  );
}
PageHeader.displayName = "PageHeader";

export { PageHeader };
export type { PageHeaderProps, PageArea };
