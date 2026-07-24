import Link from "next/link";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr";
import { formatDate } from "@/lib/format-utils";

type AttentionDate = string | Date | null;

const EMPTY_FORMATTED_DATE = formatDate(null);

export function formatDashboardRecordMetadata(
  entityCode: string,
  date: AttentionDate,
): string {
  const formattedDate = formatDate(date);
  return formattedDate === EMPTY_FORMATTED_DATE
    ? entityCode
    : `${entityCode} · ${formattedDate}`;
}

export function DashboardAttentionRow({
  href,
  metadata,
  title,
  divided = false,
}: {
  href: string;
  metadata: string;
  title: string;
  divided?: boolean;
}) {
  return (
    <li
      className={
        divided ? "border-t border-[var(--color-border-tertiary)]" : undefined
      }
    >
      <Link
        href={href}
        className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-12 py-12"
      >
        <span className="flex min-w-0 flex-col gap-2">
          <span className="label-micro font-mono text-[var(--color-text-tertiary)]">
            {metadata}
          </span>
          <span className="body-small text-[var(--color-text-primary)]">
            {title}
          </span>
        </span>
        <ArrowRightIcon
          size={14}
          weight="bold"
          className="text-[var(--color-text-tertiary)] transition-transform duration-150 group-hover:translate-x-[3px]"
          aria-hidden
        />
      </Link>
    </li>
  );
}
