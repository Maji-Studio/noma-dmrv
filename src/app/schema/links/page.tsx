import Link from "next/link";
import { ArrowLeft, ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { buttonVariants } from "@/components/ui/button";
import { getSchemaRelationships } from "@/lib/schema/catalog";

export default function SchemaLinksPage() {
  const relationships = getSchemaRelationships();

  return (
    <div className="min-h-screen bg-[var(--color-background-light)] text-[var(--color-text-primary)]">
      <main className="container-max py-32 md:py-48 flex flex-col gap-24">
        <header className="flex flex-col gap-16">
          <nav>
            <Link href="/schema" className={buttonVariants({ size: "small" })}>
              <ArrowLeft size={16} weight="bold" />
              Schema
            </Link>
          </nav>
          <p className="title-chapter-title text-[var(--clr-purple)]">Schema Links</p>
          <h1 className="title-heading-2">Foreign Key Relationships</h1>
          <p className="body-medium text-[var(--color-text-secondary)]">
            {relationships.length} direct FK links from Drizzle table definitions.
          </p>
        </header>

        <section className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)]">
          <div className="overflow-auto">
            <table className="w-full border-collapse min-w-[920px]">
              <thead>
                <tr className="bg-[var(--color-background-medium)] border-b border-[var(--color-border-primary)]">
                  <th className="text-left body-caption-fit-bold py-[10px] px-[12px]">
                    From Table
                  </th>
                  <th className="text-left body-caption-fit-bold py-[10px] px-[12px]">
                    Column
                  </th>
                  <th className="w-[32px] text-center py-[10px]" aria-label="Direction" />
                  <th className="text-left body-caption-fit-bold py-[10px] px-[12px]">
                    To Table
                  </th>
                  <th className="text-left body-caption-fit-bold py-[10px] px-[12px]">
                    Column
                  </th>
                  <th className="text-left body-caption-fit-bold py-[10px] px-[12px]">
                    onDelete
                  </th>
                  <th className="text-left body-caption-fit-bold py-[10px] px-[12px]">
                    onUpdate
                  </th>
                </tr>
              </thead>
              <tbody>
                {relationships.map((r, i) => (
                  <tr
                    key={`${r.fromTable}.${r.fromColumn}->${r.toTable}.${r.toColumn}`}
                    className={`border-b border-[var(--color-border-tertiary)] align-top hover:bg-[var(--color-background-medium)] transition-colors ${
                      i % 2 === 1 ? "bg-[var(--color-background-light)]" : ""
                    }`}
                  >
                    <td className="py-[8px] px-[12px]">
                      <Link
                        href={`/schema/${encodeURIComponent(r.fromTable)}`}
                        className="body-small underline underline-offset-2 hover:text-[var(--clr-purple)]"
                      >
                        <code>{r.fromTable}</code>
                      </Link>
                    </td>
                    <td className="py-[8px] px-[12px] body-small text-[var(--color-text-secondary)]">
                      <code>{r.fromColumn}</code>
                    </td>
                    <td className="py-[8px] text-center text-[var(--color-text-tertiary)]">
                      <ArrowRight size={14} className="inline" />
                    </td>
                    <td className="py-[8px] px-[12px]">
                      <Link
                        href={`/schema/${encodeURIComponent(r.toTable)}`}
                        className="body-small underline underline-offset-2 hover:text-[var(--clr-purple)]"
                      >
                        <code>{r.toTable}</code>
                      </Link>
                    </td>
                    <td className="py-[8px] px-[12px] body-small text-[var(--color-text-secondary)]">
                      <code>{r.toColumn}</code>
                    </td>
                    <td className="py-[8px] px-[12px]">
                      <ActionBadge value={r.onDelete} />
                    </td>
                    <td className="py-[8px] px-[12px]">
                      <ActionBadge value={r.onUpdate} />
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

function ActionBadge({ value }: { value: string }) {
  const isCascade = value === "cascade";
  const isModifying = value === "set null" || value === "set default";

  return (
    <span
      className={`body-caption px-[6px] py-[2px] ${
        isCascade
          ? "text-[var(--clr-red)] bg-[var(--clr-red-10)]"
          : isModifying
            ? "text-[var(--clr-orange)] bg-[var(--clr-orange-10)]"
            : "text-[var(--color-text-tertiary)] bg-[var(--color-background-medium)]"
      }`}
    >
      <code>{value}</code>
    </span>
  );
}
