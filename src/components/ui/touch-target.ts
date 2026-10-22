/** Footer buttons reach the 44px touch target on a phone and keep their desktop height; a wrapping label can grow. */
export const PHONE_TOUCH_TARGET = "max-sm:h-auto max-sm:min-h-44";

/**
 * A 44px hit area for a control that stays its drawn size, as a `::before`
 * centred on it and at least 44px in both axes (`w-full` keeps a wider control
 * its own width). Put it on the control itself; do not combine it with another
 * `::before` on the same element. Neighbouring controls need a gap that clears
 * it: two 32px icon buttons side by side need 12px between them or their areas
 * overlap. Use it for chips, badges and icon buttons.
 */
export const CENTRED_HIT_AREA =
  "relative before:absolute before:left-1/2 before:top-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:h-44 before:w-full before:min-w-44 before:content-['']";

/**
 * The 44px hit area for an icon-only `Button`, without its width fix. Prefer
 * `ICON_BUTTON_TOUCH_PROPS`; use this only where the button cannot take the props.
 */
export const ICON_BUTTON_HIT_AREA = `shrink-0 ${CENTRED_HIT_AREA}`;

/**
 * Spread on an icon-only `Button` to keep its 32px square and give it the 44px
 * hit area: `<Button variant="noOutline" {...ICON_BUTTON_TOUCH_PROPS} />`.
 * `width="square"` is part of the bundle because the default `width` variant
 * (`w-auto`) beats the icon size's `w-[32px]` and collapses the button to its
 * glyph. To add classes, merge: `cn(ICON_BUTTON_TOUCH_PROPS.className, "...")`.
 */
export const ICON_BUTTON_TOUCH_PROPS = {
  size: "icon",
  width: "square",
  className: ICON_BUTTON_HIT_AREA,
} as const;

/**
 * A 44px tall hit area for an inline text link or button, as an `::after` that
 * spans the control's width and is centred on its line, so the row does not
 * grow. Add `after:min-w-24` (or similar) for a very short label. The `sm:`
 * variant is for controls that already have their own 44px row below `sm`.
 */
export const INLINE_HIT_AREA =
  "relative after:absolute after:inset-x-0 after:top-1/2 after:h-44 after:-translate-y-1/2 after:content-['']";
export const INLINE_HIT_AREA_FROM_SM =
  "sm:relative sm:after:absolute sm:after:inset-x-0 sm:after:top-1/2 sm:after:h-44 sm:after:-translate-y-1/2 sm:after:content-['']";

/**
 * Row action buttons (32px and 40px tall) keep their drawn size and reach the
 * 44px touch target through an invisible `::after` centred on the button, at
 * least 44px in both axes. `OrganizationRosterRow` applies it to its actions;
 * Text buttons need nothing extra; two 32px icon buttons side by side need a
 * 12px gap or their hit areas overlap.
 */
export const ROW_ACTION_HIT_AREA =
  "[&_button]:relative [&_button]:after:absolute [&_button]:after:left-1/2 [&_button]:after:top-1/2 [&_button]:after:h-full [&_button]:after:min-h-44 [&_button]:after:w-full [&_button]:after:min-w-44 [&_button]:after:-translate-x-1/2 [&_button]:after:-translate-y-1/2 [&_button]:after:content-['']";
