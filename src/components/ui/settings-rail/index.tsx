/**
 * SettingsRail — the category menu of the settings console.
 *
 * Every category is listed under the group that owns it (You, the
 * Organization, Certification, Platform), so a click names the category and its
 * reach together. This is deliberately not a scope switch above a category
 * list: with a switch, the same word means two different things depending on
 * hidden state.
 *
 * Each row is a link, because a settings category an operator may want to
 * bookmark or open in a new tab should be a real URL. `onNavigate` lets the
 * host hold a plain click (an unsaved draft asks before it is dropped); a
 * modified click (new tab, new window) always goes through.
 *
 * Below `lg` the rail is one grouped select, so the pane starts on the first
 * screen of a phone instead of below ten menu rows (#1277).
 */
"use client";

import type { Icon } from "@phosphor-icons/react";
import type { MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export interface SettingsRailItem {
  /** Stable identity, compared with `selectedKey`. */
  key: string;
  /** One or two words. The page title repeats it; the caption explains it. */
  label: string;
  href: string;
  icon: Icon;
  /**
   * True when something here has to be decided before the surface works. Drawn
   * as a dot, never a count: digits in a menu read as step numbers, and these
   * categories are not a sequence.
   */
  needsAttention?: boolean;
}

export interface SettingsRailGroup {
  key: string;
  label: string;
  /** A second line under the group label, such as the organization's name. */
  detail?: string;
  items: readonly SettingsRailItem[];
}

const SELECT_LABEL = "Settings page";
/** The phone select's value while the current page is not a rail row. */
const UNLISTED_VALUE = "";

function isPlainLeftClick(event: MouseEvent): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

function optionLabel(item: SettingsRailItem): string {
  return item.needsAttention ? `${item.label} (needs attention)` : item.label;
}

export function SettingsRail({
  groups,
  selectedKey,
  onNavigate,
  ariaLabel = "Settings categories",
  idPrefix = "settings-rail",
  currentLabel,
}: {
  groups: readonly SettingsRailGroup[];
  selectedKey: string;
  /**
   * The page's own name, for when it is not one of the rail's rows (a URL the
   * viewer may open but the rail does not list for them). The phone select
   * shows it as the current choice, so picking any listed row navigates.
   */
  currentLabel?: string;
  /**
   * Called instead of the default navigation for a plain click on a row and
   * for a change of the phone select. Omit to let links navigate as usual.
   */
  onNavigate?: (href: string) => void;
  ariaLabel?: string;
  /** Disambiguates the group heading ids when two rails share a document. */
  idPrefix?: string;
}) {
  const router = useRouter();
  const items = groups.flatMap((group) => group.items);
  const selected = items.find((item) => item.key === selectedKey);
  const selectId = `${idPrefix}-select`;

  return (
    <>
      <div className="flex flex-col gap-4 lg:hidden">
        <label htmlFor={selectId} className="body-small font-medium text-[var(--color-text-secondary)]">
          {SELECT_LABEL}
        </label>
        <select
          id={selectId}
          value={selected?.href ?? UNLISTED_VALUE}
          onChange={(event) => {
            const href = event.target.value;
            if (onNavigate) onNavigate(href);
            else router.push(href);
          }}
          className="body-medium h-44 w-full border border-[var(--color-border-secondary)] bg-[var(--paper)] px-12"
        >
          {!selected && (
            <option value={UNLISTED_VALUE} disabled>
              {currentLabel ?? SELECT_LABEL}
            </option>
          )}
          {groups.map((group) => (
            <optgroup
              key={group.key}
              label={group.detail ? `${group.label}: ${group.detail}` : group.label}
            >
              {group.items.map((item) => (
                <option key={item.key} value={item.href}>
                  {optionLabel(item)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <nav
        aria-label={ariaLabel}
        // Sticky against `main`, which is the app shell's scrollport on desktop
        // (src/app/(app)/layout.tsx). Capped and scrollable so a long menu can
        // never push its own last row out of reach.
        className="hidden border-[1.5px] border-[var(--clr-dark-purple-40)] bg-[var(--paper)] lg:sticky lg:top-24 lg:block lg:max-h-[calc(100vh-48px)] lg:overflow-y-auto"
      >
        {groups.map((group) => {
          const headingId = `${idPrefix}-group-${group.key}`;
          return (
            <div
              key={group.key}
              className="border-b-[1.5px] border-[var(--clr-dark-purple-40)] last:border-b-0"
            >
              <div className="flex flex-col gap-4 border-b-[1px] border-[var(--clr-dark-purple-10)] px-12 py-10">
                <h2 id={headingId} className="title-chapter-title text-[var(--color-text-tertiary)]">
                  {group.label}
                </h2>
                {group.detail && (
                  <span className="body-small truncate text-[var(--color-text-secondary)]">
                    {group.detail}
                  </span>
                )}
              </div>
              <ul aria-labelledby={headingId} className="flex flex-col py-4">
                {group.items.map((item) => (
                  <li key={item.key}>
                    <RailRow
                      item={item}
                      selected={item.key === selectedKey}
                      onNavigate={onNavigate}
                    />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
    </>
  );
}

function RailRow({
  item,
  selected,
  onNavigate,
}: {
  item: SettingsRailItem;
  selected: boolean;
  onNavigate?: (href: string) => void;
}) {
  const ItemIcon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={selected ? "page" : undefined}
      onClick={(event) => {
        if (!onNavigate || !isPlainLeftClick(event)) return;
        event.preventDefault();
        onNavigate(item.href);
      }}
      className={`flex w-full items-center gap-10 border-l-[2px] py-10 pl-16 pr-12 text-left transition-colors ${
        selected
          ? "border-l-[var(--clr-red)] bg-[var(--sea)]"
          : "border-l-transparent hover:bg-[var(--sea)]"
      }`}
    >
      <ItemIcon
        size={16}
        weight="bold"
        aria-hidden
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
        {item.label}
      </span>
      {item.needsAttention && (
        <span
          role="img"
          aria-label="Needs attention"
          className="size-6 shrink-0 rounded-full bg-[var(--st-wait)]"
        />
      )}
    </Link>
  );
}
