import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr";

interface IsometricLinkProps {
  href: string;
}

const LINK_ICON_SIZE = 14;

/** Icon-only external link; the text stays for screen readers. */
export function IsometricLink({ href }: IsometricLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
    >
      <ArrowSquareOutIcon size={LINK_ICON_SIZE} weight="bold" aria-hidden />
      <span className="sr-only">View on Isometric</span>
    </a>
  );
}
