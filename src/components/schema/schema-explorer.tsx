"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { DatabaseIcon, MagnifyingGlassIcon, ArrowRightIcon, ArrowUpRightIcon, ArrowDownLeftIcon } from "@phosphor-icons/react/dist/ssr";
import { buttonVariants } from "@/components/ui/button";
import type { SchemaArea, SchemaTableInfo } from "@/lib/schema/catalog";

interface SchemaExplorerProps {
  tables: SchemaTableInfo[];
  relationshipCount: number;
}

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
  "Documentation",
  "Certification",
  "Compliance",
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
  Documentation: "var(--clr-dark-purple)",
  Certification: "var(--clr-orange)",
  Compliance: "var(--clr-red)",
  Other: "var(--color-text-tertiary)",
};

export function SchemaExplorer({ tables, relationshipCount }: SchemaExplorerProps) {
  const [query, setQuery] = useState("");
  const [area, setArea] = useState<SchemaArea | "All">("All");
  const [hideLegacy, setHideLegacy] = useState(true);

  const filteredTables = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return tables.filter((table) => {
      if (hideLegacy && table.isLegacy) return false;
      if (area !== "All" && table.area !== area) return false;
      if (!normalizedQuery) return true;

      const haystack = [
        table.name,
        table.area,
        table.summary,
        ...table.columns.map((c) => c.name),
        ...table.outboundRelationships.map((r) => `${r.toTable}.${r.toColumn}`),
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }, [area, hideLegacy, query, tables]);

  const groupedTables = useMemo(() => {
    return AREA_ORDER.map((a) => ({
      area: a,
      tables: filteredTables.filter((t) => t.area === a),
    })).filter((g) => g.tables.length > 0);
  }, [filteredTables]);

  const areaCount = new Set(tables.map((t) => t.area)).size;

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--color-text-primary)]">
      <main className="container-max py-32 md:py-48 flex flex-col gap-24">
        <header className="flex flex-col gap-16">
          <div className="flex items-center gap-[10px]">
            <DatabaseIcon size={18} weight="bold" className="text-[var(--clr-purple)]" />
            <p className="title-chapter-title text-[var(--clr-purple)]">Schema Explorer</p>
          </div>
          <h1 className="title-heading-2">Database Schema</h1>
        </header>

        <section className="grid grid-cols-1 sm:grid-cols-3 gap-16">
          <MetricCard label="Tables" value={tables.length} accent="var(--clr-purple)" />
          <MetricCard label="FK Links" value={relationshipCount} accent="var(--clr-orange)" />
          <MetricCard label="Areas" value={areaCount} accent="var(--clr-pink)" />
        </section>

        <section className="flex flex-col gap-16">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-16">
            <label className="flex flex-col gap-[6px]">
              <span className="body-caption text-[var(--color-text-tertiary)]">Search</span>
              <div className="relative">
                <MagnifyingGlassIcon
                  size={18}
                  className="absolute left-[12px] top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)] pointer-events-none"
                />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="table, column, or linked table..."
                  className="w-full h-[44px] pl-[36px] pr-s border border-[var(--color-border-primary)] bg-[var(--color-background-white)] body-medium placeholder:text-[var(--color-text-tertiary)]"
                />
              </div>
            </label>
            <label className="flex flex-col gap-[6px]">
              <span className="body-caption text-[var(--color-text-tertiary)]">Area</span>
              <select
                value={area}
                onChange={(e) => setArea(e.target.value as SchemaArea | "All")}
                className="h-[44px] px-16 border border-[var(--color-border-primary)] bg-[var(--color-background-white)] body-medium"
              >
                <option value="All">All areas</option>
                {AREA_ORDER.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
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
              <ArrowRightIcon size={16} weight="bold" />
            </Link>
          </div>
        </section>

        {groupedTables.length === 0 ? (
          <div className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-24 flex flex-col items-center gap-[12px] py-[64px]">
            <DatabaseIcon size={32} className="text-[var(--color-text-tertiary)]" />
            <p className="body-medium text-[var(--color-text-secondary)]">
              No matching tables. Try a broader query or clear filters.
            </p>
          </div>
        ) : (
          groupedTables.map((group) => {
            const accent = AREA_ACCENT[group.area];
            return (
              <section key={group.area} className="flex flex-col gap-[8px]">
                <div
                  className="flex items-baseline justify-between pb-[6px]"
                  style={{ borderBottom: `2px solid ${accent}` }}
                >
                  <h2 className="title-heading-4">{group.area}</h2>
                  <span className="body-caption text-[var(--color-text-tertiary)]">
                    {group.tables.length} {group.tables.length === 1 ? "table" : "tables"}
                  </span>
                </div>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-[8px]">
                  {group.tables.map((table) => (
                    <TableCard key={table.name} table={table} accent={accent} />
                  ))}
                </div>
              </section>
            );
          })
        )}
      </main>
    </div>
  );
}

function TableCard({ table, accent }: { table: SchemaTableInfo; accent: string }) {
  const linkedTables = Array.from(new Set(table.outboundRelationships.map((r) => r.toTable)));

  return (
    <Link
      href={`/schema/${encodeURIComponent(table.name)}`}
      className="group border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-16 hover:border-[var(--color-border-primary)] hover:bg-[var(--color-background-medium)] transition-colors flex flex-col gap-[8px]"
      style={{ borderLeftWidth: "3px", borderLeftColor: accent }}
    >
      <div className="flex flex-wrap items-center justify-between gap-[8px]">
        <p className="title-chapter-title" style={{ color: accent }}>
          {table.name}
        </p>
        <div className="flex items-center gap-[6px]">
          <Pill label={`${table.columns.length} cols`} />
          {table.outboundRelationships.length > 0 && (
            <Pill label={`${table.outboundRelationships.length}`} icon={<ArrowUpRightIcon size={12} />} />
          )}
          {table.inboundRelationships.length > 0 && (
            <Pill label={`${table.inboundRelationships.length}`} icon={<ArrowDownLeftIcon size={12} />} />
          )}
        </div>
      </div>
      <p className="body-small text-[var(--color-text-secondary)]">{table.summary}</p>
      {linkedTables.length > 0 && (
        <p className="body-caption text-[var(--color-text-tertiary)]">
          {"-> "}
          {linkedTables.slice(0, 6).join(", ")}
          {linkedTables.length > 6 && ` +${linkedTables.length - 6}`}
        </p>
      )}
    </Link>
  );
}

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

function Pill({ label, icon }: { label: string; icon?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-[3px] px-[6px] py-[2px] body-caption-fit text-[var(--color-text-secondary)] bg-[var(--color-background-medium)] border border-[var(--color-border-tertiary)]">
      {icon}
      {label}
    </span>
  );
}
