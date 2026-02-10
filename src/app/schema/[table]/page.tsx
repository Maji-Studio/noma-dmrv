import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  ArrowDownLeft,
  Key,
} from "@phosphor-icons/react/dist/ssr";
import { buttonVariants } from "@/components/ui/button";
import { getSchemaTableByName, type SchemaArea } from "@/lib/schema/catalog";

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

interface SchemaTablePageProps {
  params: Promise<{ table: string }>;
}

export default async function SchemaTablePage({ params }: SchemaTablePageProps) {
  const { table } = await params;
  const tableName = decodeURIComponent(table);
  const tableInfo = getSchemaTableByName(tableName);

  if (!tableInfo) notFound();

  const accent = AREA_ACCENT[tableInfo.area];
  const linkedToTables = Array.from(
    new Set(tableInfo.outboundRelationships.map((r) => r.toTable))
  );
  const linkedFromTables = Array.from(
    new Set(tableInfo.inboundRelationships.map((r) => r.fromTable))
  );

  return (
    <div className="min-h-screen bg-[var(--color-background-light)] text-[var(--color-text-primary)]">
      <main className="container-max py-l md:py-xl flex flex-col gap-m">
        <nav className="flex flex-wrap items-center gap-[8px]">
          <Link href="/schema" className={buttonVariants({ size: "small" })}>
            <ArrowLeft size={16} weight="bold" />
            Schema
          </Link>
          <Link
            href="/schema/links"
            className={buttonVariants({ size: "small", variant: "weak" })}
          >
            All Links
          </Link>
        </nav>

        <header
          className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-m flex flex-col gap-s"
          style={{ borderLeftWidth: "4px", borderLeftColor: accent }}
        >
          <div className="flex flex-wrap items-center gap-[8px]">
            <p className="title-chapter-title" style={{ color: accent }}>
              {tableInfo.area}
            </p>
            <span className="text-[var(--color-text-tertiary)]">·</span>
            <code className="body-caption text-[var(--color-text-tertiary)]">
              {tableInfo.modulePath}
            </code>
          </div>
          <h1 className="title-heading-2">{tableInfo.name}</h1>
          <p className="body-medium text-[var(--color-text-secondary)]">
            {tableInfo.summary}
          </p>

          <div className="flex flex-wrap items-center gap-[8px] pt-[4px]">
            <StatBadge label={`${tableInfo.columns.length} columns`} />
            <StatBadge
              label={`${tableInfo.outboundRelationships.length} outbound`}
              icon={<ArrowUpRight size={12} />}
            />
            <StatBadge
              label={`${tableInfo.inboundRelationships.length} inbound`}
              icon={<ArrowDownLeft size={12} />}
            />
            <StatBadge
              label={`${linkedToTables.length + linkedFromTables.length} linked tables`}
            />
          </div>

          {tableInfo.useCases.length > 0 && (
            <div className="flex flex-wrap gap-[6px] pt-[4px]">
              {tableInfo.useCases.map((uc) => (
                <span
                  key={uc}
                  className="body-caption text-[var(--color-text-secondary)] border border-[var(--color-border-tertiary)] bg-[var(--color-background-medium)] px-[8px] py-[3px]"
                >
                  {uc}
                </span>
              ))}
            </div>
          )}
        </header>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-s">
          <div className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-s flex flex-col gap-[8px]">
            <div className="flex items-center justify-between">
              <h2 className="title-heading-4 flex items-center gap-[6px]">
                <ArrowUpRight
                  size={18}
                  weight="bold"
                  className="text-[var(--clr-purple)]"
                />
                Outbound
              </h2>
              <span className="body-caption text-[var(--color-text-tertiary)]">
                {linkedToTables.length}{" "}
                {linkedToTables.length === 1 ? "table" : "tables"}
              </span>
            </div>
            {tableInfo.outboundRelationships.length === 0 ? (
              <p className="body-small text-[var(--color-text-tertiary)]">
                No outbound FK links.
              </p>
            ) : (
              <div className="flex flex-col gap-[6px]">
                {tableInfo.outboundRelationships.map((r) => (
                  <Link
                    key={`${r.fromColumn}->${r.toTable}.${r.toColumn}`}
                    href={`/schema/${encodeURIComponent(r.toTable)}`}
                    className="border border-[var(--color-border-tertiary)] bg-[var(--color-background-medium)] px-[10px] py-[8px] hover:border-[var(--color-border-primary)] transition-colors"
                  >
                    <p className="body-caption-fit-bold">
                      <code>{r.fromColumn}</code>
                      <span className="text-[var(--color-text-tertiary)] mx-[6px]">
                        →
                      </span>
                      <code className="text-[var(--clr-purple)]">{r.toTable}</code>
                      .<code>{r.toColumn}</code>
                    </p>
                    <p className="body-caption text-[var(--color-text-tertiary)] mt-[2px]">
                      delete: {r.onDelete} · update: {r.onUpdate}
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-s flex flex-col gap-[8px]">
            <div className="flex items-center justify-between">
              <h2 className="title-heading-4 flex items-center gap-[6px]">
                <ArrowDownLeft
                  size={18}
                  weight="bold"
                  className="text-[var(--clr-orange)]"
                />
                Inbound
              </h2>
              <span className="body-caption text-[var(--color-text-tertiary)]">
                {linkedFromTables.length}{" "}
                {linkedFromTables.length === 1 ? "table" : "tables"}
              </span>
            </div>
            {tableInfo.inboundRelationships.length === 0 ? (
              <p className="body-small text-[var(--color-text-tertiary)]">
                No inbound FK links.
              </p>
            ) : (
              <div className="flex flex-col gap-[6px]">
                {tableInfo.inboundRelationships.map((r) => (
                  <Link
                    key={`${r.fromTable}.${r.fromColumn}->${r.toColumn}`}
                    href={`/schema/${encodeURIComponent(r.fromTable)}`}
                    className="border border-[var(--color-border-tertiary)] bg-[var(--color-background-medium)] px-[10px] py-[8px] hover:border-[var(--color-border-primary)] transition-colors"
                  >
                    <p className="body-caption-fit-bold">
                      <code className="text-[var(--clr-orange)]">{r.fromTable}</code>
                      .<code>{r.fromColumn}</code>
                      <span className="text-[var(--color-text-tertiary)] mx-[6px]">
                        →
                      </span>
                      <code>{r.toColumn}</code>
                    </p>
                    <p className="body-caption text-[var(--color-text-tertiary)] mt-[2px]">
                      delete: {r.onDelete} · update: {r.onUpdate}
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)]">
          <div className="px-s pt-s">
            <h2 className="title-heading-4">
              Columns ({tableInfo.columns.length})
            </h2>
          </div>
          <div className="overflow-auto mt-[8px]">
            <table className="w-full border-collapse min-w-[760px]">
              <thead>
                <tr className="bg-[var(--color-background-medium)] border-b border-[var(--color-border-primary)]">
                  <th className="text-left body-caption-fit-bold py-[10px] px-[12px]">
                    Column
                  </th>
                  <th className="text-left body-caption-fit-bold py-[10px] px-[12px]">
                    Type
                  </th>
                  <th className="text-left body-caption-fit-bold py-[10px] px-[12px]">
                    Drizzle
                  </th>
                  <th className="text-center body-caption-fit-bold py-[10px] px-[12px] w-[60px]">
                    PK
                  </th>
                  <th className="text-center body-caption-fit-bold py-[10px] px-[12px]">
                    Null
                  </th>
                  <th className="text-center body-caption-fit-bold py-[10px] px-[12px] w-[70px]">
                    Default
                  </th>
                </tr>
              </thead>
              <tbody>
                {tableInfo.columns.map((col, i) => (
                  <tr
                    key={col.name}
                    className={`border-b border-[var(--color-border-tertiary)] align-middle ${
                      i % 2 === 1 ? "bg-[var(--color-background-light)]" : ""
                    }`}
                  >
                    <td className="py-[8px] px-[12px] body-small">
                      <span className="inline-flex items-center gap-[6px]">
                        {col.isPrimary && (
                          <Key
                            size={14}
                            weight="fill"
                            className="text-[var(--clr-purple)] shrink-0"
                          />
                        )}
                        <code>{col.name}</code>
                      </span>
                    </td>
                    <td className="py-[8px] px-[12px] body-small text-[var(--color-text-secondary)]">
                      {col.dataType}
                    </td>
                    <td className="py-[8px] px-[12px] body-small text-[var(--color-text-secondary)]">
                      <code>{col.columnType}</code>
                    </td>
                    <td className="py-[8px] px-[12px] text-center body-caption">
                      {col.isPrimary && (
                        <span className="text-[var(--clr-purple)]">
                          <code>PK</code>
                        </span>
                      )}
                    </td>
                    <td className="py-[8px] px-[12px] text-center body-caption">
                      {col.notNull ? (
                        <code className="text-[var(--color-text-primary)]">
                          NOT NULL
                        </code>
                      ) : (
                        <span className="text-[var(--color-text-tertiary)]">
                          nullable
                        </span>
                      )}
                    </td>
                    <td className="py-[8px] px-[12px] text-center body-caption text-[var(--color-text-tertiary)]">
                      {col.hasDefault ? "yes" : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
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
