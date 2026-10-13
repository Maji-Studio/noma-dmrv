import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr";
import { isometricRegistry } from "@/lib/isometric/links";

interface IsometricFeedstockLinkProps {
  isometricFeedstockTypeId: string;
  isProduction: boolean;
  /** Feedstock name, used for the accessible label. */
  name: string;
}

/** External link that opens the feedstock type in Isometric Certify. */
export function IsometricFeedstockLink({
  isometricFeedstockTypeId,
  isProduction,
  name,
}: IsometricFeedstockLinkProps) {
  return (
    <a
      href={isometricRegistry.feedstockType({
        environment: isProduction ? "production" : "sandbox",
        isometricFeedstockTypeId,
      })}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open ${name} in Isometric (new tab)`}
      className="inline-flex size-24 shrink-0 items-center justify-center text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--color-interaction)]"
    >
      <ArrowSquareOutIcon size={16} aria-hidden />
    </a>
  );
}
