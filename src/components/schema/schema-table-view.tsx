"use client";

import { useMemo, useState, useCallback, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import {
  Database,
  MagnifyingGlass,
  ArrowRight,
  ArrowUpRight,
  ArrowDownLeft,
  Key,
  CaretUp,
  CaretDown,
} from "@phosphor-icons/react/dist/ssr";
import { buttonVariants } from "@/components/ui/button";
import type { SchemaArea, SchemaColumnInfo, SchemaRelationship, SchemaTableInfo } from "@/lib/schema/catalog";
import columnExamples from "@/lib/schema/column-examples.json";
import columnDescriptions from "@/lib/schema/column-descriptions.json";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const AREA_ORDER: SchemaArea[] = [
  "Auth",
  "Facilities",
  "Parties",
  "Feedstock",
  "Production",
  "Products",
  "Logistics",
  "Application",
  "Credits",
  "Emissions",
  "Documentation",
  "Certification",
  "Compliance",
  "Legacy/Core Template",
  "Other",
];

const AREA_ACCENT: Record<SchemaArea, string> = {
  Auth: "var(--clr-purple)",
  Facilities: "var(--clr-orange)",
  Parties: "var(--clr-rose)",
  Feedstock: "var(--clr-pink)",
  Production: "var(--clr-orange)",
  Products: "var(--clr-rose)",
  Logistics: "var(--clr-dark-purple)",
  Application: "var(--clr-pink)",
  Credits: "var(--clr-purple)",
  Emissions: "var(--clr-red)",
  Documentation: "var(--clr-dark-purple)",
  Certification: "var(--clr-orange)",
  Compliance: "var(--clr-red)",
  "Legacy/Core Template": "var(--color-text-tertiary)",
  Other: "var(--color-text-tertiary)",
};

/* ------------------------------------------------------------------ */
/*  TanStack Table column defs                                         */
/* ------------------------------------------------------------------ */

interface ColumnRow extends SchemaColumnInfo {
  isForeignKey: boolean;
  example: string;
  description: string;
}

const columnHelper = createColumnHelper<ColumnRow>();

const columnDefs = [
  columnHelper.accessor("name", {
    header: "Column",
    cell: (info) => (
      <span className="inline-flex items-center gap-[6px]">
        {info.row.original.isPrimary && <Key size={14} weight="fill" className="text-[var(--clr-purple)] shrink-0" />}
        <code>{info.getValue()}</code>
      </span>
    ),
  }),
  columnHelper.accessor("dataType", {
    header: "Type",
    cell: (info) => <span className="text-[var(--color-text-secondary)]">{info.getValue()}</span>,
  }),
  columnHelper.display({
    id: "key",
    header: "Key",
    cell: ({ row }) => {
      const { isPrimary, isForeignKey } = row.original;
      if (isPrimary && isForeignKey)
        return (
          <span className="inline-flex gap-[4px]">
            <code className="text-[var(--clr-purple)]">PK</code>
            <code className="text-[var(--clr-orange)]">FK</code>
          </span>
        );
      if (isPrimary) return <code className="text-[var(--clr-purple)]">PK</code>;
      if (isForeignKey) return <code className="text-[var(--clr-orange)]">FK</code>;
      return null;
    },
    enableSorting: true,
  }),
  columnHelper.accessor("notNull", {
    header: "Required",
    cell: (info) =>
      info.getValue() ? <span className="text-[var(--color-text-primary)]">yes</span> : null,
  }),
  columnHelper.accessor("hasDefault", {
    header: "Default",
    cell: (info) => <span className="text-[var(--color-text-tertiary)]">{info.getValue() ? "yes" : "—"}</span>,
  }),
  columnHelper.accessor("example", {
    header: "Example",
    enableSorting: false,
    cell: (info) => {
      const val = info.getValue();
      if (!val) return <span className="text-[var(--color-text-tertiary)]">—</span>;
      return (
        <code className="text-[var(--color-text-secondary)] break-all" title={val}>
          {val.length > 40 ? val.slice(0, 37) + "..." : val}
        </code>
      );
    },
  }),
  columnHelper.accessor("description", {
    header: "Description",
    enableSorting: false,
    cell: (info) => {
      const val = info.getValue();
      if (!val) return <span className="text-[var(--color-text-tertiary)]">—</span>;
      return (
        <span className="body-small text-[var(--color-text-secondary)]" title={val}>
          {val.length > 60 ? val.slice(0, 57) + "..." : val}
        </span>
      );
    },
  }),
];

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface SchemaTableViewProps {
  tables: SchemaTableInfo[];
  relationships: SchemaRelationship[];
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function SchemaTableView({ tables, relationships }: SchemaTableViewProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hideLegacy, setHideLegacy] = useState(true);

  const activeArea = (searchParams.get("area") as SchemaArea) || AREA_ORDER[0];
  const selectedTableName = searchParams.get("table") ?? "";

  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null) params.delete(key);
        else params.set(key, value);
      }
      const qs = params.toString();
      router.replace(qs ? `/schema?${qs}` : "/schema", { scroll: false });
    },
    [searchParams, router],
  );

  /* Derive visible areas (with at least 1 table) */
  const areasWithTables = AREA_ORDER.filter((a) => {
    if (hideLegacy && (a === "Legacy/Core Template" || a === "Other")) {
      const hasNonLegacy = tables.some((t) => t.area === a && !t.isLegacy);
      if (!hasNonLegacy) return false;
    }
    return tables.some((t) => {
      if (hideLegacy && t.isLegacy) return false;
      return t.area === a;
    });
  });

  /* Ensure activeArea is valid */
  const resolvedArea = areasWithTables.includes(activeArea) ? activeArea : areasWithTables[0];

  /* Tables in active area, filtered by search */
  const normalizedQuery = query.trim().toLowerCase();
  const areaTablesAll = tables.filter((t) => {
    if (hideLegacy && t.isLegacy) return false;
    return t.area === resolvedArea;
  });
  const areaTables = normalizedQuery
    ? areaTablesAll.filter((t) => {
        const haystack = [t.name, t.summary, ...t.columns.map((c) => c.name)].join(" ").toLowerCase();
        return haystack.includes(normalizedQuery);
      })
    : areaTablesAll;

  /* Selected table */
  const selectedTable = areaTables.find((t) => t.name === selectedTableName) ?? areaTables[0];

  /* Stats */
  const totalTables = tables.filter((t) => !hideLegacy || !t.isLegacy).length;
  const areaCount = new Set(tables.filter((t) => !hideLegacy || !t.isLegacy).map((t) => t.area)).size;

  return (
    <div className="min-h-screen bg-[var(--color-background-light)] text-[var(--color-text-primary)]">
      <main className="container-max py-32 md:py-48 flex flex-col gap-24">
        {/* Header */}
        <header className="flex flex-col gap-16">
          <div className="flex items-center gap-[10px]">
            <Database size={18} weight="bold" className="text-[var(--clr-purple)]" />
            <p className="title-chapter-title text-[var(--clr-purple)]">Schema Explorer</p>
          </div>
          <h1 className="title-heading-2">Database Schema</h1>
        </header>

        {/* Stats row */}
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-16">
          <MetricCard label="Tables" value={totalTables} accent="var(--clr-purple)" />
          <MetricCard label="FK Links" value={relationships.length} accent="var(--clr-orange)" />
          <MetricCard label="Areas" value={areaCount} accent="var(--clr-pink)" />
        </section>

        {/* Controls: search + legacy toggle + links button */}
        <section className="flex flex-col gap-16">
          <div className="relative max-w-[480px]">
            <MagnifyingGlass
              size={18}
              className="absolute left-[12px] top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)] pointer-events-none"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tables, columns..."
              className="w-full h-[44px] pl-[36px] pr-s border border-[var(--color-border-primary)] bg-[var(--color-background-white)] body-medium placeholder:text-[var(--color-text-tertiary)]"
            />
          </div>
          <div className="flex items-center justify-between flex-wrap gap-16">
            <label className="inline-flex items-center gap-[8px] body-small text-[var(--color-text-secondary)] select-none cursor-pointer">
              <input
                type="checkbox"
                checked={hideLegacy}
                onChange={(e) => setHideLegacy(e.target.checked)}
                className="size-[16px] accent-[var(--clr-purple)]"
              />
              Hide legacy tables
            </label>
            <Link href="/schema/links" className={buttonVariants({ size: "small" })}>
              All FK Links
              <ArrowRight size={16} weight="bold" />
            </Link>
          </div>
        </section>

        {/* Area tabs */}
        <div className="flex gap-0 overflow-x-auto border-b border-[var(--color-border-secondary)]" role="tablist">
          {areasWithTables.map((a) => {
            const isActive = a === resolvedArea;
            const accent = AREA_ACCENT[a];
            const count = tables.filter((t) => {
              if (hideLegacy && t.isLegacy) return false;
              return t.area === a;
            }).length;
            return (
              <button
                key={a}
                role="tab"
                aria-selected={isActive}
                onClick={() => updateParams({ area: a, table: null })}
                className="shrink-0 h-[48px] px-[16px] label-button transition-colors cursor-pointer"
                style={{
                  color: isActive ? accent : "var(--color-text-secondary)",
                  borderBottom: isActive ? `2px solid ${accent}` : "2px solid transparent",
                  background: isActive ? "var(--color-background-white)" : "transparent",
                }}
              >
                {a}
                <span className="pl-4 body-caption text-[var(--color-text-tertiary)]">{count}</span>
              </button>
            );
          })}
        </div>

        {/* Table pills */}
        {areaTables.length > 0 ? (
          <>
            <div className="flex flex-wrap gap-[6px]" role="tablist">
              {areaTables.map((t) => {
                const isActive = t.name === selectedTable?.name;
                const accent = AREA_ACCENT[resolvedArea];
                return (
                  <button
                    key={t.name}
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => updateParams({ area: resolvedArea, table: t.name })}
                    className="h-[32px] px-[10px] body-caption-fit-bold border transition-colors cursor-pointer"
                    style={{
                      borderColor: isActive ? accent : "var(--color-border-tertiary)",
                      color: isActive ? accent : "var(--color-text-secondary)",
                      background: isActive ? "var(--color-background-white)" : "var(--color-background-medium)",
                    }}
                  >
                    {t.name}
                  </button>
                );
              })}
            </div>

            {/* Selected table detail */}
            {selectedTable && <SelectedTablePanel table={selectedTable} accent={AREA_ACCENT[resolvedArea]} />}
          </>
        ) : (
          <div className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-24 flex flex-col items-center gap-[12px] py-[64px]">
            <Database size={32} className="text-[var(--color-text-tertiary)]" />
            <p className="body-medium text-[var(--color-text-secondary)]">No matching tables. Try a broader query.</p>
          </div>
        )}
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Selected table panel                                               */
/* ------------------------------------------------------------------ */

function SelectedTablePanel({ table, accent }: { table: SchemaTableInfo; accent: string }) {
  const linkedToTables = Array.from(new Set(table.outboundRelationships.map((r) => r.toTable)));
  const linkedFromTables = Array.from(new Set(table.inboundRelationships.map((r) => r.fromTable)));

  return (
    <div className="flex flex-col gap-16">
      {/* Table header card */}
      <div
        className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-16 flex flex-col gap-[8px]"
        style={{ borderLeftWidth: "4px", borderLeftColor: accent }}
      >
        <div className="flex flex-wrap items-center gap-[8px]">
          <p className="title-chapter-title" style={{ color: accent }}>
            {table.name}
          </p>
          <span className="text-[var(--color-text-tertiary)]">·</span>
          <code className="body-caption text-[var(--color-text-tertiary)]">{table.modulePath}</code>
          <Link
            href={`/schema/${encodeURIComponent(table.name)}`}
            className="ml-auto body-caption text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] underline underline-offset-2"
          >
            detail page →
          </Link>
        </div>
        <p className="body-medium text-[var(--color-text-secondary)]">{table.summary}</p>
        <div className="flex flex-wrap items-center gap-[8px]">
          <StatBadge label={`${table.columns.length} columns`} />
          <StatBadge label={`${table.outboundRelationships.length} outbound`} icon={<ArrowUpRight size={12} />} />
          <StatBadge label={`${table.inboundRelationships.length} inbound`} icon={<ArrowDownLeft size={12} />} />
          <StatBadge label={`${linkedToTables.length + linkedFromTables.length} linked tables`} />
        </div>
        {table.useCases.length > 0 && (
          <div className="flex flex-wrap gap-[6px]">
            {table.useCases.map((uc) => (
              <span
                key={uc}
                className="body-caption text-[var(--color-text-secondary)] border border-[var(--color-border-tertiary)] bg-[var(--color-background-medium)] px-[8px] py-[3px]"
              >
                {uc}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Columns table */}
      <ColumnsTable tableName={table.name} columns={table.columns} outboundRelationships={table.outboundRelationships} />

      {/* Relationships */}
      {(table.outboundRelationships.length > 0 || table.inboundRelationships.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
          <RelationshipPanel
            title="Outbound"
            icon={<ArrowUpRight size={18} weight="bold" className="text-[var(--clr-purple)]" />}
            relationships={table.outboundRelationships}
            linkedCount={linkedToTables.length}
            renderRow={(r) => (
              <>
                <p className="body-caption-fit-bold">
                  <code>{r.fromColumn}</code>
                  <span className="text-[var(--color-text-tertiary)] mx-[6px]">→</span>
                  <code className="text-[var(--clr-purple)]">{r.toTable}</code>.<code>{r.toColumn}</code>
                </p>
                <p className="body-caption text-[var(--color-text-tertiary)] mt-[2px]">
                  delete: {r.onDelete} · update: {r.onUpdate}
                </p>
              </>
            )}
            getHref={(r) => `/schema/${encodeURIComponent(r.toTable)}`}
          />
          <RelationshipPanel
            title="Inbound"
            icon={<ArrowDownLeft size={18} weight="bold" className="text-[var(--clr-orange)]" />}
            relationships={table.inboundRelationships}
            linkedCount={linkedFromTables.length}
            renderRow={(r) => (
              <>
                <p className="body-caption-fit-bold">
                  <code className="text-[var(--clr-orange)]">{r.fromTable}</code>.<code>{r.fromColumn}</code>
                  <span className="text-[var(--color-text-tertiary)] mx-[6px]">→</span>
                  <code>{r.toColumn}</code>
                </p>
                <p className="body-caption text-[var(--color-text-tertiary)] mt-[2px]">
                  delete: {r.onDelete} · update: {r.onUpdate}
                </p>
              </>
            )}
            getHref={(r) => `/schema/${encodeURIComponent(r.fromTable)}`}
          />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Columns table (TanStack Table)                                     */
/* ------------------------------------------------------------------ */

function ColumnsTable({
  tableName,
  columns: rawData,
  outboundRelationships,
}: {
  tableName: string;
  columns: SchemaColumnInfo[];
  outboundRelationships: SchemaRelationship[];
}) {
  const [sorting, setSorting] = useState<SortingState>([]);

  // Must be memoized — TanStack Table triggers re-renders on data reference changes
  const data: ColumnRow[] = useMemo(() => {
    const fkColumnNames = new Set(outboundRelationships.map((r) => r.fromColumn));
    const examples = (columnExamples as Record<string, Record<string, unknown>>)[tableName] ?? {};
    const descriptions = (columnDescriptions as Record<string, Record<string, string>>)[tableName] ?? {};
    return rawData.map((col) => ({
      ...col,
      isForeignKey: fkColumnNames.has(col.name),
      example: col.name in examples ? String(examples[col.name] ?? "") : "",
      description: descriptions[col.name] ?? "",
    }));
  }, [rawData, outboundRelationships, tableName]);

  const table = useReactTable({
    data,
    columns: columnDefs,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)]">
      <div className="overflow-auto">
        <table className="w-full border-collapse min-w-[900px]">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr
                key={headerGroup.id}
                className="bg-[var(--color-background-medium)] border-b border-[var(--color-border-primary)]"
              >
                {headerGroup.headers.map((header) => {
                  const isSortable = header.column.getCanSort();
                  const sortDir = header.column.getIsSorted();
                  const isPkOrBool = ["key", "notNull", "hasDefault"].includes(header.column.id);
                  return (
                    <th
                      key={header.id}
                      className={`body-caption-fit-bold py-[10px] px-[12px] ${
                        isPkOrBool ? "text-center w-[70px]" : "text-left"
                      } ${isSortable ? "cursor-pointer select-none" : ""}`}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      <span className="inline-flex items-center gap-[4px]">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {isSortable && (
                          <span className="inline-flex flex-col leading-none text-[var(--color-text-tertiary)]">
                            <CaretUp size={10} weight={sortDir === "asc" ? "fill" : "regular"} />
                            <CaretDown size={10} weight={sortDir === "desc" ? "fill" : "regular"} />
                          </span>
                        )}
                      </span>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row, i) => (
              <tr
                key={row.id}
                className={`border-b border-[var(--color-border-tertiary)] align-middle ${
                  i % 2 === 1 ? "bg-[var(--color-background-light)]" : ""
                }`}
              >
                {row.getVisibleCells().map((cell) => {
                  const isPkOrBool = ["key", "notNull", "hasDefault"].includes(cell.column.id);
                  return (
                    <td key={cell.id} className={`py-[8px] px-[12px] body-small ${isPkOrBool ? "text-center" : ""}`}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Relationship panel                                                 */
/* ------------------------------------------------------------------ */

function RelationshipPanel({
  title,
  icon,
  relationships,
  linkedCount,
  renderRow,
  getHref,
}: {
  title: string;
  icon: ReactNode;
  relationships: SchemaRelationship[];
  linkedCount: number;
  renderRow: (r: SchemaRelationship) => ReactNode;
  getHref: (r: SchemaRelationship) => string;
}) {
  return (
    <div className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-16 flex flex-col gap-[8px]">
      <div className="flex items-center justify-between">
        <h3 className="title-heading-4 flex items-center gap-[6px]">
          {icon}
          {title}
        </h3>
        <span className="body-caption text-[var(--color-text-tertiary)]">
          {linkedCount} {linkedCount === 1 ? "table" : "tables"}
        </span>
      </div>
      {relationships.length === 0 ? (
        <p className="body-small text-[var(--color-text-tertiary)]">No {title.toLowerCase()} FK links.</p>
      ) : (
        <div className="flex flex-col gap-[6px]">
          {relationships.map((r) => (
            <Link
              key={`${r.fromTable}.${r.fromColumn}->${r.toTable}.${r.toColumn}`}
              href={getHref(r)}
              className="border border-[var(--color-border-tertiary)] bg-[var(--color-background-medium)] px-[10px] py-[8px] hover:border-[var(--color-border-primary)] transition-colors"
            >
              {renderRow(r)}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared small components                                            */
/* ------------------------------------------------------------------ */

function MetricCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div
      className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-16"
      style={{ borderLeftWidth: "3px", borderLeftColor: accent }}
    >
      <p className="body-caption text-[var(--color-text-tertiary)]">{label}</p>
      <p className="title-heading-3 mt-[4px]">{value}</p>
    </div>
  );
}

function StatBadge({ label, icon }: { label: string; icon?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-[4px] body-caption bg-[var(--color-background-medium)] border border-[var(--color-border-tertiary)] text-[var(--color-text-secondary)] px-[8px] py-[3px]">
      {icon}
      <code>{label}</code>
    </span>
  );
}
