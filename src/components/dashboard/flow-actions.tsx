/**
 * The record actions along the flow: each stage cell ends with its own
 * actions, in a strip under a hairline, as sentence-case labels with a
 * trailing arrow. There is no New credit batch here: the header's credit
 * batch filter and the credit batch page cover it.
 */
"use client";

import Link from "next/link";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr";
import type { DashboardOverview, DashboardStationKey } from "@/data-access/dashboard-overview";
import type { OnboardingStatus } from "@/data-access/onboarding";
import { useCustomers } from "@/hooks/use-customers";
import { useOrders } from "@/hooks/use-orders";
import { createIntentHref } from "@/lib/create-intent";
import { cn } from "@/lib/utils";
import { FOCUS_RING, type QuickAction } from "./shared";

/** One count query: the list's total, or undefined until it is known. */
const COUNT_ONLY = { page: 1, pageSize: 1 };

/**
 * Each action shows only when its form can be saved with what the facility
 * has now (the form's required pickers, without inline add):
 * - New feedstock intake: a supplier exists (as the setup guide asks).
 * - New production run: a reactor and a feedstock intake (its source bin).
 * - New biochar product: a complete production run (its biochar bin).
 * - New order: a customer (the form has no inline add for customers; a
 *   formulation it can add inline).
 * - New delivery: an order at this facility and a biochar product to load.
 * - New application: a delivery at this facility.
 * - New supplier: always (suppliers keep being added).
 * Counts that are still loading hide the action rather than guess.
 */
export function useFlowActions(
  status: OnboardingStatus | undefined,
  facilityId: string,
  data: DashboardOverview | undefined,
): QuickAction[] {
  const customers = useCustomers(COUNT_ONLY).data?.total;
  const orders = useOrders({ ...COUNT_ONLY, facilityId }).data?.total;
  if (!status || !data) return [];
  const facility = status.facility;
  const stationTotal = (key: DashboardStationKey) => data.stations.find((station) => station.key === key)?.total ?? 0;
  const href = (path: string) => createIntentHref(path, facilityId);
  const completeRuns = facility?.completeProductionRunCount ?? 0;

  const actions: (QuickAction | false)[] = [
    status.supplierCount > 0 && {
      key: "feedstock", label: "New feedstock intake", href: href("/feedstock-intake"), stage: "feedstock",
    },
    (facility?.reactorCount ?? 0) > 0 && (facility?.feedstockCount ?? 0) > 0 && {
      key: "run", label: "New production run", href: href("/production-runs"), stage: "production",
    },
    completeRuns > 0 && {
      key: "product", label: "New biochar product", href: href("/biochar-products"), stage: "products",
    },
    customers != null && customers > 0 && {
      key: "order", label: "New order", href: href("/orders"), stage: "deliveries",
    },
    orders != null && orders > 0 && stationTotal("products") > 0 && {
      key: "delivery", label: "New delivery", href: href("/deliveries"), stage: "deliveries",
    },
    stationTotal("deliveries") > 0 && {
      key: "application", label: "New application", href: href("/applications"), stage: "applications",
    },
    // Always: suppliers keep being added.
    {
      key: "supplier", label: "New supplier", href: href("/suppliers"), stage: "suppliers",
    },
  ];
  return actions.filter((action): action is QuickAction => action !== false);
}

/**
 * The actions a stage carries. New supplier sits in the Suppliers cell (the
 * cell is otherwise empty and it is that stage's record).
 */
export function stageActions(actions: QuickAction[], stage: DashboardStationKey): QuickAction[] {
  return actions.filter((action) => action.stage === stage);
}

/** A cell's action: a plain quiet link, label then arrow; at least 44px tall. */
function ActionLink({ action }: { action: QuickAction }) {
  return (
    <Link
      href={action.href}
      className={cn(
        // 44px tall at every width: a tap that misses it would hit the stage link underneath.
        "inline-flex min-h-44 max-w-full items-center px-6 py-6 text-left body-small font-medium text-[var(--color-text-primary)] transition-colors",
        "hover:bg-[var(--color-surface-medium)]",
        FOCUS_RING,
      )}
    >
      {/* The arrow rides on the label's last word, so it wraps with it. */}
      <span>
        {action.label}
        <ArrowRightIcon size={14} weight="bold" className="ml-6 inline-block align-[-2px] text-[var(--color-interaction)]" aria-hidden />
      </span>
    </Link>
  );
}

/** A cell's actions, stacked and start aligned, wrapping inside a narrow cell. */
export function StageActionStack({ actions, className }: { actions: QuickAction[]; className?: string }) {
  if (actions.length === 0) return null;
  return (
    <div className={cn("flex flex-col items-start", className)}>
      {actions.map((action) => (
        <ActionLink key={action.key} action={action} />
      ))}
    </div>
  );
}
