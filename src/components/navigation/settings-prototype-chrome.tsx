/**
 * Throwaway sidebar chrome for the settings prototype (branch
 * prototype/settings-simplification, never merged). Every export renders only
 * when `/settings?variant=A|B|D` is open; `SidebarContent` falls back to the
 * real header and footer otherwise.
 *
 * - A: the footer gear says "Settings" and opens the one console.
 * - B: the footer becomes an account button with the account menu.
 * - D: the header is always an org switcher with a role chip; the footer is an
 *   account popover.
 */
"use client";

import { usePathname, useSearchParams } from "next/navigation";
import {
  CaretDownIcon,
  CaretUpDownIcon,
  CheckIcon,
  GearSixIcon,
  GlobeIcon,
  PlugsConnectedIcon,
  SignOutIcon,
  UserCircleIcon,
  BuildingsIcon,
  WarehouseIcon,
} from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { DropdownMenu, Popover } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import {
  parseSettingsPrototypeVariant,
  setSettingsPrototypeParams,
  type SettingsPrototypeVariant,
} from "@/components/settings/prototype/use-settings-prototype-variant";
import {
  fixtures,
  PROTOTYPE_SAVE_TOAST,
} from "@/components/settings/prototype/abd-fixtures";
import {
  enterAbdOrg,
  useAbdActiveOrg,
  type ActiveRole,
} from "@/components/settings/prototype/abd-active-org";

/** The prototype variant, only while the prototype route is open. */
export function useSidebarPrototypeVariant(): SettingsPrototypeVariant | null {
  const pathname = usePathname();
  const params = useSearchParams();
  if (process.env.NODE_ENV === "production") return null;
  if (pathname !== "/settings") return null;
  return parseSettingsPrototypeVariant(params.get("variant"));
}

function Avatar({ name }: { name: string }) {
  return (
    <div
      className="size-32 flex items-center justify-center shrink-0"
      style={{
        background: `linear-gradient(135deg, var(--clr-purple) 0%, var(--clr-pink) 100%)`,
      }}
    >
      <span className="body-caption font-medium text-white">
        {name.charAt(0)}
      </span>
    </div>
  );
}

/** Role chip on the dark sidebar. Platform Admin is the loud one. */
function DarkRoleChip({ role }: { role: ActiveRole }) {
  const loud = role === "Platform Admin";
  return (
    <span
      className={cn(
        "body-caption shrink-0 whitespace-nowrap px-6 py-2",
        loud
          ? "bg-[var(--clr-orange)] font-medium text-[var(--clr-dark-purple)]"
          : "border border-[var(--color-white-25)] text-[var(--color-white-75)]",
      )}
    >
      {role}
    </span>
  );
}

/** Role chip inside light menus. */
function LightRoleChip({ role }: { role: ActiveRole }) {
  const loud = role === "Platform Admin";
  return (
    <span
      className={cn(
        "body-caption shrink-0 whitespace-nowrap border px-6",
        loud
          ? "border-[var(--st-wait-border)] bg-[var(--st-wait-bg)] text-[var(--st-wait)]"
          : "border-[var(--color-border-secondary)] text-[var(--color-text-secondary)]",
      )}
    >
      {role}
    </span>
  );
}

function useSignOutStub() {
  const toast = useToast();
  return () => toast.info("Prototype: sign out is not wired here");
}

/* -------------------------------------------------------------------------------------------------
 * A: footer gear opens the one settings console
 * -----------------------------------------------------------------------------------------------*/

export function PrototypeFooterA({ onNavigate }: { onNavigate?: () => void }) {
  const active = useAbdActiveOrg("a-org");
  const signOut = useSignOutStub();
  return (
    <div className="shrink-0 px-6 pb-12 flex flex-col gap-4">
      <div className="flex items-center gap-10 px-12 py-8 mt-2 bg-[var(--color-white-100)]/[0.03]">
        <Avatar name={active.user.name} />
        <div className="flex flex-col min-w-0 flex-1">
          <span className="body-caption font-medium text-white truncate">
            {active.user.name}
          </span>
          <span className="text-[10px] text-[var(--color-white-50)] truncate">
            {active.user.email}
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            setSettingsPrototypeParams({ "a-pane": null });
            onNavigate?.();
          }}
          className="flex items-center justify-center size-44 md:size-28 text-[var(--color-white-50)] hover:text-white transition-colors duration-150"
          aria-label="Settings"
        >
          <GearSixIcon size={16} />
        </button>
        <button
          type="button"
          onClick={signOut}
          className="flex items-center justify-center size-44 md:size-28 text-[var(--color-white-50)] hover:text-[var(--clr-rose)] transition-colors duration-150"
          aria-label="Sign out"
        >
          <SignOutIcon size={16} />
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------------------------------
 * B: account button + account menu
 * -----------------------------------------------------------------------------------------------*/

export function PrototypeAccountMenuB({ onNavigate }: { onNavigate?: () => void }) {
  const active = useAbdActiveOrg("b-org");
  const toast = useToast();
  const signOut = useSignOutStub();
  const isAdmin = active.viewer === "platform-admin";

  const open = (page: string | null, extra: Record<string, string | null> = {}) => {
    setSettingsPrototypeParams({ "b-page": page, ...extra });
    onNavigate?.();
  };

  const orgRows: { id: string; name: string; role: ActiveRole }[] = isAdmin
    ? [{ id: active.id, name: active.name, role: "Platform Admin" }]
    : fixtures.memberships.map((m) => ({ id: m.id, name: m.name, role: m.role }));

  return (
    <div className="shrink-0 px-6 pb-12">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          render={
            <button
              type="button"
              className="flex w-full items-center gap-10 px-12 py-8 mt-2 min-h-56 text-left bg-[var(--color-white-100)]/[0.03] hover:bg-[var(--color-white-100)]/[0.08] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--clr-purple)]"
              aria-label={`Account menu, ${active.user.name}`}
            />
          }
        >
          <Avatar name={active.user.name} />
          <span className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="body-caption font-medium text-white truncate">
              {active.user.name}
            </span>
            <span className="text-[10px] text-[var(--color-white-50)] truncate">
              {active.name}
            </span>
            {isAdmin && (
              <span className="flex">
                <DarkRoleChip role="Platform Admin" />
              </span>
            )}
          </span>
          <CaretUpDownIcon
            size={14}
            weight="bold"
            className="shrink-0 text-[var(--color-white-50)]"
            aria-hidden
          />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content side="top" align="start" className="w-[280px]">
          <div className="flex flex-col px-12 py-8">
            <span className="body-small font-medium">{active.user.name}</span>
            <span className="body-caption text-[var(--color-text-tertiary)] truncate">
              {active.user.email}
            </span>
          </div>
          <DropdownMenu.Item onClick={() => open("profile")}>
            <UserCircleIcon size={16} weight="bold" aria-hidden />
            Profile
          </DropdownMenu.Item>
          <DropdownMenu.Item onClick={() => open("connected-apps")}>
            <PlugsConnectedIcon size={16} weight="bold" aria-hidden />
            Connected apps
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          <p className="body-caption px-12 pb-2 pt-4 text-[var(--color-text-tertiary)]">
            {isAdmin ? "You are working in" : "Organizations"}
          </p>
          {orgRows.map((org) => {
            const current = org.id === active.id;
            return (
              <DropdownMenu.Item
                key={org.id}
                onClick={() => {
                  if (current) return open("organization");
                  enterAbdOrg("b-org", org.id, { "b-page": null });
                  toast.info(`Prototype: now in ${org.name}`);
                  onNavigate?.();
                }}
              >
                <span className="flex w-16 shrink-0 justify-center">
                  {current && <CheckIcon size={14} weight="bold" aria-label="Current" />}
                </span>
                <span className="min-w-0 flex-1 truncate">{org.name}</span>
                <LightRoleChip role={org.role} />
              </DropdownMenu.Item>
            );
          })}
          <DropdownMenu.Item onClick={() => open("organization")}>
            <GearSixIcon size={16} weight="bold" aria-hidden />
            Organization settings
          </DropdownMenu.Item>
          {isAdmin && (
            <>
              <DropdownMenu.Separator />
              <DropdownMenu.Item onClick={() => open("platform")}>
                <GlobeIcon size={16} weight="bold" aria-hidden />
                Platform: all organizations
              </DropdownMenu.Item>
            </>
          )}
          <DropdownMenu.Separator />
          <DropdownMenu.Item onClick={signOut}>
            <SignOutIcon size={16} weight="bold" aria-hidden />
            Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  );
}

/* -------------------------------------------------------------------------------------------------
 * D: always-on org switcher with role chip, and an account popover
 * -----------------------------------------------------------------------------------------------*/

export function PrototypeOrgSwitcherD({ onNavigate }: { onNavigate?: () => void }) {
  const active = useAbdActiveOrg("d-org");
  const toast = useToast();
  const isAdmin = active.viewer === "platform-admin";

  const rows: { id: string; name: string; role: ActiveRole }[] = isAdmin
    ? fixtures.organizations.map((o) => ({ id: o.id, name: o.name, role: "Platform Admin" }))
    : fixtures.memberships.map((m) => ({ id: m.id, name: m.name, role: m.role }));

  return (
    <div className="h-56 border-b border-[var(--color-white-10)] shrink-0">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          render={
            <button
              type="button"
              className="group flex h-full w-full items-center gap-10 px-16 text-left hover:bg-[var(--color-white-100)]/[0.04] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--clr-purple)]"
              aria-label={`Organization: ${active.name}, ${active.role}. Switch organization`}
            />
          }
        >
          <div className="size-28 bg-[var(--clr-purple)] flex items-center justify-center shrink-0">
            <span className="text-white font-bold text-[length:var(--text-xxs)] leading-none">
              {active.name.charAt(0)}
            </span>
          </div>
          <span className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="body-small font-medium text-white truncate">
              {active.name}
            </span>
            <span className="flex">
              <DarkRoleChip role={active.role} />
            </span>
          </span>
          <CaretDownIcon
            size={12}
            weight="bold"
            className="shrink-0 text-[var(--color-white-50)] group-hover:text-white"
            aria-hidden
          />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content side="bottom" align="start" className="w-[280px]">
          <p className="body-caption px-12 pb-2 pt-4 text-[var(--color-text-tertiary)]">
            {isAdmin ? "Open an organization" : "Your organizations"}
          </p>
          {rows.map((org) => {
            const current = org.id === active.id;
            return (
              <DropdownMenu.Item
                key={org.id}
                onClick={() => {
                  if (current) return;
                  enterAbdOrg("d-org", org.id);
                  toast.info(`Prototype: now in ${org.name}`);
                  onNavigate?.();
                }}
              >
                <span className="flex w-16 shrink-0 justify-center">
                  {current && <CheckIcon size={14} weight="bold" aria-label="Current" />}
                </span>
                <span className="min-w-0 flex-1 truncate">{org.name}</span>
                <LightRoleChip role={org.role} />
              </DropdownMenu.Item>
            );
          })}
          {isAdmin && (
            <>
              <DropdownMenu.Separator />
              <DropdownMenu.Item
                onClick={() => {
                  setSettingsPrototypeParams({ "d-side": "platform" });
                  onNavigate?.();
                }}
              >
                <BuildingsIcon size={16} weight="bold" aria-hidden />
                Platform: all organizations
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  );
}

export function PrototypeAccountPopoverD({ onNavigate }: { onNavigate?: () => void }) {
  const active = useAbdActiveOrg("d-org");
  const toast = useToast();
  const signOut = useSignOutStub();
  const isAdmin = active.viewer === "platform-admin";

  return (
    <div className="shrink-0 px-6 pb-12">
      <Popover
        title="Your account"
        side="top"
        align="start"
        className="w-[min(340px,calc(100vw-32px))]"
        trigger={
          <button
            type="button"
            className="flex w-full items-center gap-10 px-12 py-8 mt-2 min-h-56 text-left bg-[var(--color-white-100)]/[0.03] hover:bg-[var(--color-white-100)]/[0.08] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--clr-purple)]"
            aria-label={`Your account, ${active.user.name}`}
          >
            <Avatar name={active.user.name} />
            <span className="flex min-w-0 flex-1 flex-col gap-2">
              <span className="body-caption font-medium text-white truncate">
                {active.user.name}
              </span>
              <span className="text-[10px] text-[var(--color-white-50)] truncate">
                {active.user.email}
              </span>
            </span>
            <CaretUpDownIcon
              size={14}
              weight="bold"
              className="shrink-0 text-[var(--color-white-50)]"
              aria-hidden
            />
          </button>
        }
      >
        <div className="flex flex-col gap-16">
          <div className="flex items-center gap-10">
            <Avatar name={active.user.name} />
            <div className="flex min-w-0 flex-col">
              <span className="body-small font-medium truncate">{active.user.name}</span>
              <span className="body-caption text-[var(--color-text-tertiary)] truncate">
                {active.user.email}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <button
              type="button"
              onClick={() => toast.info(PROTOTYPE_SAVE_TOAST)}
              className="body-small flex min-h-44 items-center gap-8 px-8 text-left hover:bg-[var(--color-surface-medium)]"
            >
              <UserCircleIcon size={16} weight="bold" aria-hidden />
              Edit name
            </button>
            <button
              type="button"
              onClick={() => toast.info(PROTOTYPE_SAVE_TOAST)}
              className="body-small flex min-h-44 items-center gap-8 px-8 text-left hover:bg-[var(--color-surface-medium)]"
            >
              <GearSixIcon size={16} weight="bold" aria-hidden />
              Change password
            </button>
          </div>

          <div className="flex flex-col gap-8 border-t border-[var(--color-border-secondary)] pt-12">
            <span className="body-small font-medium">Connected apps</span>
            {isAdmin ? (
              <span className="body-caption text-[var(--color-text-tertiary)]">
                Platform Admins cannot connect apps.
              </span>
            ) : (
              fixtures.connectedApps.map((app) => (
                <div key={app.id} className="flex items-center justify-between gap-8">
                  <span className="flex min-w-0 flex-col">
                    <span className="body-small truncate">{app.name}</span>
                    <span className="body-caption text-[var(--color-text-tertiary)] truncate">
                      {app.org} · since {app.connected}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => toast.info(PROTOTYPE_SAVE_TOAST)}
                    className="body-caption min-h-44 shrink-0 px-8 underline"
                  >
                    Disconnect
                  </button>
                </div>
              ))
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              signOut();
              onNavigate?.();
            }}
            className="body-small flex min-h-44 items-center gap-8 border-t border-[var(--color-border-secondary)] px-8 pt-4 text-left hover:bg-[var(--color-surface-medium)]"
          >
            <SignOutIcon size={16} weight="bold" aria-hidden />
            Sign out
          </button>
        </div>
      </Popover>
    </div>
  );
}

/* -------------------------------------------------------------------------------------------------
 * A and B: plain fixture brand; A, B and D: fixture facility row
 * -----------------------------------------------------------------------------------------------*/

/** The org name from the prototype fixtures, so the header matches the page. */
export function PrototypeBrand({ param }: { param: "a-org" | "b-org" }) {
  const active = useAbdActiveOrg(param);
  return (
    <div className="flex items-center gap-10 h-56 px-16 border-b border-[var(--color-white-10)] shrink-0">
      <div className="size-28 bg-[var(--clr-purple)] flex items-center justify-center shrink-0">
        <span className="text-white font-bold text-[length:var(--text-xxs)] leading-none">
          {active.name.charAt(0)}
        </span>
      </div>
      <span className="body-small font-medium text-white truncate">{active.name}</span>
    </div>
  );
}

/** Stand-in for the working-facility selector, showing the fixture facility. */
export function PrototypeFacilityRow() {
  const toast = useToast();
  return (
    <div className="mx-8 px-10 py-10">
      <button
        type="button"
        onClick={() => toast.info("Prototype: the working facility stays Mafinga")}
        className="relative flex w-full h-44 md:h-36 items-center gap-8 pl-10 pr-10 bg-[var(--color-white-100)]/[0.06] border border-[var(--color-white-10)] text-white body-caption text-left"
      >
        <WarehouseIcon size={16} weight="fill" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{fixtures.facilities[0].name}</span>
        <CaretDownIcon size={14} weight="bold" className="text-[var(--color-white-50)]" aria-hidden />
      </button>
    </div>
  );
}

/** Mobile top bar brand for A, B and D: the fixture org, plus D's role chip. */
export function PrototypeMobileBrand({ variant }: { variant: "A" | "B" | "D" }) {
  const param = variant === "A" ? "a-org" : variant === "B" ? "b-org" : "d-org";
  const active = useAbdActiveOrg(param);
  return (
    <div className="flex min-w-0 items-center gap-10">
      <div className="size-28 bg-[var(--clr-purple)] flex items-center justify-center shrink-0">
        <span className="text-white font-bold text-[length:var(--text-xxs)] leading-none">
          {active.name.charAt(0)}
        </span>
      </div>
      <span className="body-small font-medium text-white truncate">{active.name}</span>
      {(variant === "D" || active.isPlatformAdminInside) && <DarkRoleChip role={active.role} />}
    </div>
  );
}
