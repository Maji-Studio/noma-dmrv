/**
 * The required indicator: a red star for sighted users and "Required" for
 * screen readers. A star means the save refuses this field empty; it shows only
 * in the state that needs it (docs/forms.md, "Required stars"). Import it by
 * file path, never through the forms barrel (ui to forms import cycle).
 * `visual={false}` renders only the screen reader text, for a legend whose
 * visible label already carries the star. Do not add `aria-required` beside it:
 * the control would announce the requirement twice.
 */
export function RequiredMarker({ visual = true }: { visual?: boolean }) {
  return (
    <>
      {visual && (
        <span className="text-[var(--color-signal-red)] ml-2" aria-hidden="true">
          *
        </span>
      )}
      <span className="sr-only">Required</span>
    </>
  );
}
