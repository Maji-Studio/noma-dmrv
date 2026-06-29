/**
 * Admin users management page
 * Allows admins to invite and manage users. The invitation UI is intentionally
 * stubbed in this scaffold — the page renders the layout that the full feature
 * will inhabit so spacing and chrome stay consistent with the rest of admin.
 */
import type { Icon } from "@phosphor-icons/react";
import {
  EnvelopeSimpleIcon,
  ShieldCheckIcon,
  UserPlusIcon,
  UsersIcon,
} from "@phosphor-icons/react/dist/ssr";

interface PlannedCapability {
  icon: Icon;
  title: string;
  description: string;
}

const PLANNED_CAPABILITIES: PlannedCapability[] = [
  {
    icon: UserPlusIcon,
    title: "Invite users",
    description:
      "Send email invitations with a role pre-assigned. Invitees set their own password on first sign-in.",
  },
  {
    icon: EnvelopeSimpleIcon,
    title: "Pending invitations",
    description:
      "Resend or revoke invitations that haven't been accepted yet.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Roles & access",
    description:
      "Promote users to admin or downgrade them, and remove access entirely.",
  },
];

export default function AdminUsersPage() {
  return (
    <div className="container-max page-shell">
      <header className="flex flex-col gap-8">
        <span className="title-chapter-title text-[var(--color-text-tertiary)]">
          Admin
        </span>
        <h1 className="title-heading-2">User Management</h1>
        <p className="body-medium text-[var(--color-text-secondary)] max-w-[680px]">
          Invite teammates, manage active users, and assign roles. The full UI
          isn&apos;t wired up in this scaffold yet.
        </p>
      </header>

      <section className="flex flex-col gap-16 border border-dashed border-[var(--color-border-secondary)] bg-[var(--color-background-white)] px-24 py-32 items-center text-center">
        <UsersIcon size={48} className="text-[var(--color-text-tertiary)]" />
        <div className="flex flex-col gap-8 max-w-[520px]">
          <h2 className="title-heading-3">User invitation UI coming soon</h2>
          <p className="body-small text-[var(--color-text-secondary)]">
            Today, admin access is bootstrapped via the{" "}
            <code className="body-caption font-mono bg-[var(--color-background-medium)] px-4 py-2">
              ADMIN_EMAIL
            </code>{" "}
            environment variable. The full invitation flow is planned next.
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-16">
        <h2 className="title-heading-3">Planned capabilities</h2>
        <ul className="grid grid-cols-1 gap-16 md:grid-cols-3">
          {PLANNED_CAPABILITIES.map(({ icon: Icon, title, description }) => (
            <li
              key={title}
              className="flex flex-col gap-12 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-20"
            >
              <span className="flex size-32 items-center justify-center border border-[var(--color-border-tertiary)] text-[var(--color-text-primary)]">
                <Icon size={18} weight="bold" />
              </span>
              <div className="flex flex-col gap-4">
                <span className="body-small font-medium text-[var(--color-text-primary)]">
                  {title}
                </span>
                <p className="body-caption text-[var(--color-text-secondary)]">
                  {description}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
