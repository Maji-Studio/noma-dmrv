/**
 * Small bottom-left overlay shown when the basemap style failed to load and
 * the map fell back to a blank style. Deliberately compact instead of a
 * `Notice`: the order-sheet route map is too small for the 16px icon and
 * body-size text, and it must not cover the route. Same look on every map.
 */

const NOTE_CLASS =
  "absolute bottom-16 left-16 z-10 max-w-[calc(100%-96px)] border-[1.5px] border-[var(--clr-dark-purple-20)] bg-[var(--paper)] px-10 py-6 text-[9.5px] font-medium text-[var(--clr-dark-purple-60)]";

export function BasemapUnavailableNote({ testId }: { testId: string }) {
  return (
    <div className={NOTE_CLASS} role="status" data-testid={testId}>
      Basemap unavailable. Switch to SAT or reload.
    </div>
  );
}
