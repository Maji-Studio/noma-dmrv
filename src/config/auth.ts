/** Shared password bounds for Better Auth, form schemas, and CLI bootstrap. */
export const AUTH_PASSWORD_MIN_LENGTH = 8;
export const AUTH_PASSWORD_MAX_LENGTH = 72;

export const PROFILE_NAME_MAX_LENGTH = 100;

export const CHANGE_EMAIL_MAX_ATTEMPTS = 5;
export const CHANGE_EMAIL_WINDOW_SECONDS = 15 * 60;

/**
 * How long a browser trusts its signed session snapshot before asking the
 * database again. A session revoked elsewhere (another device signed out by a
 * password change) keeps working for at most this long.
 */
export const SESSION_COOKIE_CACHE_SECONDS = 5 * 60;

/** Pending invitations expire after 7 days. */
export const INVITATION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;

/** Match Better Auth's default limit on unexpired pending invitations. */
export const ORGANIZATION_INVITATION_LIMIT = 100;

/** Seconds in one hour, for token lifetimes and the email wording built from them. */
export const SECONDS_PER_HOUR = 60 * 60;

/** Email verification links expire after 24 hours. */
export const EMAIL_VERIFICATION_EXPIRES_IN_SECONDS = SECONDS_PER_HOUR * 24;

/** Password reset links expire after 1 hour (Better Auth's default, now explicit). */
export const PASSWORD_RESET_EXPIRES_IN_SECONDS = SECONDS_PER_HOUR;
