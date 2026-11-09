# =============================================================================
# noma-dmrv DEPLOYED Environment Variables (1Password Template)
# =============================================================================
# Source of truth for what syncs to Vercel (pnpm env:vercel reads this file;
# staging item -> preview, production item -> production). For machine-local
# values use .env.local.tpl + pnpm env:local instead.
#
# REQUIRED_DEPLOYED_VARS in scripts/env-tpl-utils.ts defines the required set.
# Variables outside that set may be absent from a 1Password item: the sync
# skips them with a warning instead of failing.
# NODE_ENV is never synced to Vercel. Staging one-off runs use
# NODE_ENV=development like local; prod runs force NODE_ENV=production so
# production guards apply.

# -----------------------------------------------------------------------------
# Database (PostgreSQL via Drizzle ORM)
# -----------------------------------------------------------------------------
DATABASE_URL="op://Environment Variables/noma-dmrv env staging/DATABASE_URL"
DB_POOL_MAX="op://Environment Variables/noma-dmrv env staging/DB_POOL_MAX"
DB_POOL_IDLE_TIMEOUT_MS="op://Environment Variables/noma-dmrv env staging/DB_POOL_IDLE_TIMEOUT_MS"
DB_POOL_CONNECTION_TIMEOUT_MS="op://Environment Variables/noma-dmrv env staging/DB_POOL_CONNECTION_TIMEOUT_MS"
DB_POOL_LOCK_TIMEOUT_MS="op://Environment Variables/noma-dmrv env staging/DB_POOL_LOCK_TIMEOUT_MS"
# Managed database CA (PEM) so the pg pool verifies TLS with full checking.
DATABASE_CA_CERT="op://Environment Variables/noma-dmrv env staging/DATABASE_CA_CERT"

# -----------------------------------------------------------------------------
# App URL (Used for Better Auth and general app links)
# -----------------------------------------------------------------------------
NEXT_PUBLIC_APP_URL="op://Environment Variables/noma-dmrv env staging/NEXT_PUBLIC_APP_URL"

# -----------------------------------------------------------------------------
# Better Auth (Authentication)
# -----------------------------------------------------------------------------
BETTER_AUTH_SECRET="op://Environment Variables/noma-dmrv env staging/BETTER_AUTH_SECRET"
CRON_SECRET="op://Environment Variables/noma-dmrv env staging/CRON_SECRET"

# -----------------------------------------------------------------------------
# Resend (Email Service)
# -----------------------------------------------------------------------------
RESEND_API_KEY="op://Environment Variables/noma-dmrv env staging/RESEND_API_KEY"
RESEND_FROM_EMAIL="op://Environment Variables/noma-dmrv env staging/RESEND_FROM_EMAIL"
RESEND_REPLY_TO="op://Environment Variables/noma-dmrv env staging/RESEND_REPLY_TO"
WALKTHROUGH_TO="op://Environment Variables/noma-dmrv env staging/WALKTHROUGH_TO"

# -----------------------------------------------------------------------------
# Isometric (Carbon Registry API)
# -----------------------------------------------------------------------------
CREDENTIALS_ENCRYPTION_KEY="op://Environment Variables/noma-dmrv env staging/CREDENTIALS_ENCRYPTION_KEY"
# sandbox in the staging 1Password item, production in the production item — the
# sync rewrites the item, not the field, so one line serves both environments.
ISOMETRIC_ENVIRONMENT="op://Environment Variables/noma-dmrv env staging/ISOMETRIC_ENVIRONMENT"

# -----------------------------------------------------------------------------
# Storage (S3-compatible object storage)
# -----------------------------------------------------------------------------
STORAGE_PROVIDER="op://Environment Variables/noma-dmrv env staging/STORAGE_PROVIDER"
STORAGE_BUCKET="op://Environment Variables/noma-dmrv env staging/STORAGE_BUCKET"
STORAGE_REGION="op://Environment Variables/noma-dmrv env staging/STORAGE_REGION"
STORAGE_ENDPOINT="op://Environment Variables/noma-dmrv env staging/STORAGE_ENDPOINT"
STORAGE_PREFIX="op://Environment Variables/noma-dmrv env staging/STORAGE_PREFIX"
STORAGE_ACCESS_KEY_ID="op://Environment Variables/noma-dmrv env staging/STORAGE_ACCESS_KEY_ID"
STORAGE_SECRET_ACCESS_KEY="op://Environment Variables/noma-dmrv env staging/STORAGE_SECRET_ACCESS_KEY"

# -----------------------------------------------------------------------------
# Licensed fonts (build only): read-only Spaces key for scripts/fetch-fonts.mjs.
# Optional: without it builds use the fallback system fonts.
# -----------------------------------------------------------------------------
FONTS_S3_ACCESS_KEY_ID="op://Environment Variables/noma-dmrv env staging/FONTS_S3_ACCESS_KEY_ID"
FONTS_S3_SECRET_ACCESS_KEY="op://Environment Variables/noma-dmrv env staging/FONTS_S3_SECRET_ACCESS_KEY"

# -----------------------------------------------------------------------------
# Geo / Maps (map integration — ADR 0009)
# The key is OPTIONAL: without it the app still runs; CALC and address search
# degrade gracefully. OPENROUTESERVICE_API_KEY is server-only (geocoding +
# routing). The basemap (OpenFreeMap) needs no key. GEO_PROVIDER is not templated — it defaults to
# "ors"; "stub" is for hermetic tests only (.env.test) and is rejected in prod.
# -----------------------------------------------------------------------------
OPENROUTESERVICE_API_KEY="op://Environment Variables/noma-dmrv env staging/OPENROUTESERVICE_API_KEY"

# -----------------------------------------------------------------------------
# App Configuration
# -----------------------------------------------------------------------------
NODE_ENV=development
