interface IsometricLinkProps {
  href: string;
}

export function IsometricLink({ href }: IsometricLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="body-caption text-[var(--color-text-tertiary)] underline underline-offset-2 hover:text-[var(--color-text-secondary)]"
    >
      View on Isometric ↗
    </a>
  );
}
