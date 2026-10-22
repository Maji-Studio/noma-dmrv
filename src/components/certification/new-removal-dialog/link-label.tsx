/**
 * Links that open in a new tab. The last word and the icon share a no-wrap
 * span, so a label that wraps never leaves the icon alone on a line of its own.
 */
import Link from "next/link";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";

const LINK_ICON_SIZE = 12;

export function LinkLabel({ children }: { children: string }) {
  const split = children.lastIndexOf(" ");
  const head = split === -1 ? "" : children.slice(0, split + 1);
  const last = split === -1 ? children : children.slice(split + 1);
  return (
    <>
      {head}
      <span className="whitespace-nowrap">
        {last}
        <ArrowSquareOutIcon size={LINK_ICON_SIZE} aria-hidden className="ml-4 inline align-baseline" />
      </span>
    </>
  );
}

interface NewTabLinkProps {
  href: string;
  children: string;
  className?: string;
  mono?: boolean;
  ariaLabel?: string;
  /** 44px tall on a phone. */
  tall?: boolean;
}

export function NewTabLink({ href, children, className, mono, ariaLabel, tall }: NewTabLinkProps) {
  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={ariaLabel}
      className={cn(
        "text-[var(--color-text-primary)] underline-offset-4 hover:text-[var(--color-interaction)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]",
        tall && "inline-flex min-h-44 items-center md:min-h-0",
        mono && "font-mono",
        className,
      )}
    >
      {/* One span keeps the label flowing as text inside a flex link. */}
      <span>
        <LinkLabel>{children}</LinkLabel>
      </span>
    </Link>
  );
}
