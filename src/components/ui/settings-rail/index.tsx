/**
 * SettingsRail — the category menu for a settings console.
 *
 * Every category is listed under the tier that owns it — Organization,
 * Facility, Platform — so a click names the category and its reach together and
 * no selection can land on the wrong tier. This is deliberately not a scope
 * switch above a category list: with a switch, the same word ("Registry") means
 * two different things depending on hidden state.
 *
 * Two consoles use it and they select differently. `/certification/settings` is
 * one route that swaps panes via `?section=`, so its rows are buttons with
 * `onSelect`. `/settings` is a route per category, so its rows carry `href` and
 * render as links — a settings category an operator may want to bookmark or open
 * in a new tab should be a real URL. A section supplies one or the other; a row
 * with `href` ignores `onSelect`.
 */
"use client";

import type { Icon } from "@phosphor-icons/react";
import Link from "next/link";

/** Which tier a category configures. Renders as the rail's group heading. */
export type SettingsTier = "organization" | "facility" | "platform";

export interface SettingsSectionMeta {
  /** Stable identity: the `?section=` value, or the route's own key. */
  key: string;
  tier: SettingsTier;
  /** One word. The pane header repeats it; the caption explains it. */
  label: string;
  icon: Icon;
  /** Render as a link to this route instead of an in-place selector. */
  href?: string;
  /**
   * True when something here has to be decided before the surface works. Drawn
   * as a dot, never a count: digits in a menu read as step numbers, and these
   * categories are not a sequence.
   */
  needsAttention?: boolean;
}

const TIER_LABELS: Record<SettingsTier, string> = {
  organization: "Organization",
  facility: "Facility",
  platform: "Platform",
};

const TIER_ORDER: readonly SettingsTier[] = [
  "organization",
  "facility",
  "platform",
];

export function SettingsRail({
  sections,
  selectedKey,
  onSelect,
  ariaLabel = "Settings categories",
  idPrefix = "settings-rail",
}: {
  sections: readonly SettingsSectionMeta[];
  selectedKey: string;
  /** Required for sections without an `href`; ignored for link rows. */
  onSelect?: (key: string) => void;
  ariaLabel?: string;
  /** Disambiguates the tier heading ids when two rails share a document. */
  idPrefix?: string;
}) {
  return (
    <nav
      aria-label={ariaLabel}
      // Sticky against `main`, which is the app shell's scrollport on desktop
      // (src/app/(app)/layout.tsx). Capped and scrollable so a long menu can
      // never push its own last row out of reach.
      className="border-[1.5px] border-[var(--clr-dark-purple-40)] bg-[var(--paper)] lg:sticky lg:top-24 lg:max-h-[calc(100vh-48px)] lg:overflow-y-auto"
    >
      {TIER_ORDER.map((tier) => {
        const tierSections = sections.filter((s) => s.tier === tier);
        if (tierSections.length === 0) return null;

        const headingId = `${idPrefix}-tier-${tier}`;
        return (
          <div
            key={tier}
            className="border-b-[1.5px] border-[var(--clr-dark-purple-40)] last:border-b-0"
          >
            <h2
              id={headingId}
              className="title-chapter-title border-b-[1px] border-[var(--clr-dark-purple-10)] px-12 py-10 text-[var(--color-text-tertiary)]"
            >
              {TIER_LABELS[tier]}
            </h2>
            <ul aria-labelledby={headingId} className="flex flex-col py-4">
              {tierSections.map((section) => (
                <li key={section.key}>
                  <RailRow
                    section={section}
                    selected={section.key === selectedKey}
                    onSelect={onSelect}
                  />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function RailRow({
  section,
  selected,
  onSelect,
}: {
  section: SettingsSectionMeta;
  selected: boolean;
  onSelect?: (key: string) => void;
}) {
  const SectionIcon = section.icon;
  const className = `flex w-full items-center gap-10 border-l-[2px] py-10 pl-16 pr-12 text-left transition-colors ${
    selected
      ? "border-l-[var(--clr-red)] bg-[var(--sea)]"
      : "border-l-transparent hover:bg-[var(--sea)]"
  }`;

  const body = (
    <>
      <SectionIcon
        size={16}
        weight="bold"
        className={
          selected
            ? "shrink-0 text-[var(--clr-red)]"
            : "shrink-0 text-[var(--color-text-tertiary)]"
        }
      />
      <span
        className={`body-small min-w-0 flex-1 truncate ${
          selected
            ? "text-[var(--color-text-primary)]"
            : "text-[var(--color-text-secondary)]"
        }`}
      >
        {section.label}
      </span>
      {section.needsAttention && (
        <span
          aria-label="Needs attention"
          className="size-6 shrink-0 rounded-full bg-[var(--st-wait)]"
        />
      )}
    </>
  );

  if (section.href) {
    return (
      <Link
        href={section.href}
        aria-current={selected ? "page" : undefined}
        className={className}
      >
        {body}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelect?.(section.key)}
      aria-current={selected ? "page" : undefined}
      className={className}
    >
      {body}
    </button>
  );
}
