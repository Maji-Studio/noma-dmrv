/**
 * One kind's DataTable: client-side search, sort and paging over the
 * organization's full list, rows that open the side sheet, a ⋮ menu with Edit
 * and Delete, and the kind's empty, loading and error states.
 */
"use client";

import { useState } from "react";
import { PlusIcon } from "@phosphor-icons/react/dist/ssr";
import { ServerError } from "@/components/forms";
import { Button, EmptyState } from "@/components/ui";
import { DataTable } from "@/components/ui/data-table";
import type { FleetRecords } from "@/hooks/use-fleet";
import type { FleetKind } from "@/lib/fleet/messages";
import { EMPTY_ICON_SIZE, FLEET_HIDDEN_COLUMNS, FLEET_KIND_COPY, fleetColumns } from "./fleet-kinds";
import type { FleetKindManager } from "./use-fleet-kind-manager";

interface FleetKindTableProps<K extends FleetKind> {
  manager: FleetKindManager<K>;
  /** Link behind each row's name, so it opens in a new tab and shows its URL. */
  getRowHref?: (record: FleetRecords[K]) => string | undefined;
}

export function FleetKindTable<K extends FleetKind>({ manager, getRowHref }: FleetKindTableProps<K>) {
  const copy = FLEET_KIND_COPY[manager.kind];
  const [search, setSearch] = useState("");
  const hasSearch = search.trim().length > 0;

  if (manager.error) {
    return (
      <ServerError
        message={`${copy.title} could not be loaded. Try again.`}
        action={
          <Button size="small" onClick={manager.refetch}>
            Try again
          </Button>
        }
      />
    );
  }

  const columns = fleetColumns<K>(manager.kind, {
    onEdit: manager.openEdit,
    onDelete: manager.requestDelete,
  } as Parameters<typeof fleetColumns<K>>[1]);

  return (
    <DataTable<FleetRecords[K], unknown>
      columns={columns}
      data={manager.records}
      defaultColumnVisibility={FLEET_HIDDEN_COLUMNS[manager.kind]}
      onRowClick={manager.openView}
      enableSorting
      enableFiltering
      enablePagination
      globalFilter={search}
      onGlobalFilterChange={setSearch}
      getRowHref={getRowHref}
      aria-label={copy.title}
      isLoading={manager.isLoading}
      hoverable
      emptyMessage={
        <EmptyState
          padding="md"
          icon={copy.icon(EMPTY_ICON_SIZE)}
          title={hasSearch ? `No matching ${copy.title.toLowerCase()}` : `No ${copy.title.toLowerCase()} yet`}
          description={hasSearch ? "Try clearing your search." : copy.emptyDescription}
          action={
            hasSearch ? undefined : (
              <Button variant="primary" onClick={manager.openCreate}>
                <PlusIcon size={18} weight="bold" />
                New {copy.noun}
              </Button>
            )
          }
        />
      }
    >
      <DataTable.Toolbar>
        <DataTable.Search placeholder={`Search ${copy.title.toLowerCase()}...`} aria-label={`Search ${copy.title.toLowerCase()}`} />
        <DataTable.Controls>
          <DataTable.ColumnVisibility />
        </DataTable.Controls>
      </DataTable.Toolbar>
      <DataTable.Pagination />
    </DataTable>
  );
}
