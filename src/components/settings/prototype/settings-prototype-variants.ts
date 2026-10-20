/**
 * Throwaway: the settings prototype variant list and parser. Plain module (no
 * hooks) so the server page can import it.
 */
export const SETTINGS_PROTOTYPE_VARIANTS = ["A", "B", "C", "D", "E"] as const;
export type SettingsPrototypeVariant =
  (typeof SETTINGS_PROTOTYPE_VARIANTS)[number];

export function parseSettingsPrototypeVariant(
  value: string | null | undefined,
): SettingsPrototypeVariant | null {
  if (!value) return null;
  const upper = value.toUpperCase();
  return (SETTINGS_PROTOTYPE_VARIANTS as readonly string[]).includes(upper)
    ? (upper as SettingsPrototypeVariant)
    : null;
}
