export const API_KEY_DEFAULT_EXPIRY_DAYS = 90;
export const API_KEY_MAX_EXPIRY_DAYS = 365;
export const SECONDS_PER_DAY = 24 * 60 * 60;
export const MILLISECONDS_PER_SECOND = 1000;
export const API_KEY_DEFAULT_EXPIRY_SECONDS = API_KEY_DEFAULT_EXPIRY_DAYS * SECONDS_PER_DAY;
export const API_KEY_MAX_EXPIRY_SECONDS = API_KEY_MAX_EXPIRY_DAYS * SECONDS_PER_DAY;
export const API_KEY_NAME_MAX_LENGTH = 32;
/** Short-lived trials, the default, longer integrations, and the server cap. */
export const API_KEY_EXPIRY_PRESET_DAYS = [30, API_KEY_DEFAULT_EXPIRY_DAYS, 180, API_KEY_MAX_EXPIRY_DAYS] as const;
