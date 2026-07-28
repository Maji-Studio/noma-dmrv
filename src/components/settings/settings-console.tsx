/**
 * SettingsConsole — the frame every `/settings` page renders inside.
 *
 * Same shape as `/certification/settings` (rail plus one pane) and the same
 * `SettingsRail`, with one difference: these categories are routes, not
 * `?section=` panes. A route per category is right here because the two are
 * genuinely different pages with different access rules — the member roster is
 * readable by any member, the operating defaults only by Owners/Admins — and
 * because `/settings/organization` was already a URL people have.
 *
 * The rail is the hub, which is why there is no `/settings` landing page: a
 * tile grid whose tiles are also permanently in the left rail is the thing
 * `/admin` was, and it was one hop too many.
 */
"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import {
  BuildingsIcon,
  SlidersHorizontalIcon,
  UsersIcon,
} from "@phosphor-icons/react/dist/ssr";
import { PageHeader, SettingsRail, type SettingsSectionMeta } from "@/components/ui";

/** A rail plus a form pane stops being readable past roughly this width. */
const CONSOLE_MAX_WIDTH = "max-w-[1160px]";

export const SETTINGS_MEMBERS_HREF = "/settings/organization";
export const SETTINGS_DEFAULTS_HREF = "/settings/defaults";
const ADMIN_ORGANIZATIONS_HREF = "/admin/organizations";

interface SettingsConsoleProps {
  /** Pane title. Also the rail row that renders as selected. */
  title: string;
  /** One line under the pane title, explaining what the pane configures. */
  caption: string;
  /** Who may change what is in this pane, for the pane footnote. */
  access: string;
  subtitle: string;
  /** Owner/Admin. Gates the Defaults category — it is Owner/Admin-only. */
  canManageDefaults: boolean;
  /** Adds the cross-tenant organization directory to the rail. */
  isPlatformAdmin: boolean;
  children: ReactNode;
}

export function SettingsConsole({
  title,
  caption,
  access,
  subtitle,
  canManageDefaults,
  isPlatformAdmin,
  children,
}: SettingsConsoleProps) {
  const pathname = usePathname();

  const sections: SettingsSectionMeta[] = [
    {
      key: SETTINGS_MEMBERS_HREF,
      href: SETTINGS_MEMBERS_HREF,
      tier: "organization",
      label: "Members",
      icon: UsersIcon,
    },
  ];

  if (canManageDefaults) {
    sections.push({
      key: SETTINGS_DEFAULTS_HREF,
      href: SETTINGS_DEFAULTS_HREF,
      tier: "organization",
      label: "Defaults",
      icon: SlidersHorizontalIcon,
    });
  }

  if (isPlatformAdmin) {
    // The only surface that genuinely lives under `/admin`. It is here because
    // a Platform Admin reaching for "settings" is reaching for this, and the
    // `/admin` hub that used to advertise it is gone.
    sections.push({
      key: ADMIN_ORGANIZATIONS_HREF,
      href: ADMIN_ORGANIZATIONS_HREF,
      tier: "platform",
      label: "Organizations",
      icon: BuildingsIcon,
    });
  }

  return (
    <div className="container-max page-shell">
      <div className={CONSOLE_MAX_WIDTH}>
        <PageHeader eyebrow="Settings" title={title} subtitle={subtitle} />
      </div>

      <div
        className={`${CONSOLE_MAX_WIDTH} grid gap-24 lg:grid-cols-[236px_minmax(0,1fr)] lg:items-start`}
      >
        <SettingsRail
          sections={sections}
          selectedKey={pathname}
          ariaLabel="Settings categories"
          idPrefix="organization-settings"
        />

        {/* A presentational card, so a plain div: as a `section` it became an
            ancestor of every pane's own sections, and a `section`-scoped query
            for one of them silently widened to the whole pane. */}
        <div className="border-[1.5px] border-[var(--clr-dark-purple-40)] bg-[var(--paper)]">
          <div className="flex flex-col gap-4 border-b-[1px] border-[var(--clr-dark-purple-10)] bg-[var(--sea)] px-24 py-16">
            <h2 className="title-heading-3">{title}</h2>
            <p className="body-caption text-[var(--color-text-tertiary)]">
              {caption}
            </p>
          </div>

          <div className="p-24">{children}</div>

          <div className="border-t-[1px] border-[var(--clr-dark-purple-10)] px-24 py-16">
            <span className="body-caption text-[var(--color-text-tertiary)]">
              {access} can change these.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
