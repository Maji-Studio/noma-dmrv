import type { ReactNode } from "react";

/** A hairline-separated block in a settings pane; untitled when its one field already names it. */
export function PaneSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-12 border-t-[1px] border-[var(--clr-dark-purple-10)] pt-16 first:border-t-0 first:pt-0">
      {title && <h3 className="body-caption text-[var(--color-text-tertiary)]">{title}</h3>}
      {children}
    </section>
  );
}
