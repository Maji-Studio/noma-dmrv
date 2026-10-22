/** Footer buttons reach the 44px touch target on a phone and keep their desktop height; a wrapping label can grow. */
export const PHONE_TOUCH_TARGET = "max-sm:h-auto max-sm:min-h-44";

/**
 * Row action buttons (32px and 40px tall) keep their drawn size and reach the
 * 44px touch target through an invisible `::after` centred on the button, at
 * least 44px in both axes. `OrganizationRosterRow` applies it to its actions;
 * Text buttons need nothing extra; two 32px icon buttons side by side need a
 * 12px gap or their hit areas overlap.
 */
export const ROW_ACTION_HIT_AREA =
  "[&_button]:relative [&_button]:after:absolute [&_button]:after:left-1/2 [&_button]:after:top-1/2 [&_button]:after:h-full [&_button]:after:min-h-44 [&_button]:after:w-full [&_button]:after:min-w-44 [&_button]:after:-translate-x-1/2 [&_button]:after:-translate-y-1/2 [&_button]:after:content-['']";
