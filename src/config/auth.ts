/** Shared password bounds for Better Auth, form schemas, and CLI bootstrap. */
export const AUTH_PASSWORD_MIN_LENGTH = 8;
export const AUTH_PASSWORD_MAX_LENGTH = 72;

export const PROFILE_NAME_MAX_LENGTH = 100;

/**
 * How long a browser trusts its signed session snapshot before asking the
 * database again. A session revoked elsewhere (another device signed out by a
 * password change) keeps working for at most this long.
 */
export const SESSION_COOKIE_CACHE_SECONDS = 5 * 60;

/** Pending invitations expire after 7 days. */
export const INVITATION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;
