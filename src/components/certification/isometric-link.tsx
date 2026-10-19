import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr";

interface IsometricLinkProps {
  href: string;
  /**
   * Visible text. Omit it when the link sits next to the value it opens (an
   * ID or a code): the link is then an icon with a 24px target, and the text
   * stays for screen readers and as the hover title. Pass it when the link is
   * the whole value of a field, so the field never reads as empty.
   */
  label?: string;
}

const LINK_ICON_SIZE = 14;
const LINK_NAME = "View on Isometric";

export function IsometricLink({ href, label }: IsometricLinkProps) {
  if (label) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-24 items-center gap-4 text-[var(--color-text-secondary)] underline underline-offset-2 hover:text-[var(--color-text-primary)]"
      >
        {label}
        <ArrowSquareOutIcon size={LINK_ICON_SIZE} weight="bold" aria-hidden />
      </a>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={LINK_NAME}
      className="inline-flex size-24 shrink-0 items-center justify-center text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
    >
      <ArrowSquareOutIcon size={LINK_ICON_SIZE} weight="bold" aria-hidden />
      <span className="sr-only">{LINK_NAME}</span>
    </a>
  );
}
