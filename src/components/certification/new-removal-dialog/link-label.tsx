/**
 * The text of a link that opens in a new tab, with its icon. The last word and
 * the icon share a no-wrap span, so a label that wraps never leaves the icon
 * alone on a line of its own.
 */
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr";

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
