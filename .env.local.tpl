# =============================================================================
# noma-dmrv LOCAL Environment Variables (1Password Template)
# =============================================================================
# Run: pnpm env:local — injects from the `noma-dmrv env local` item into
# .env.local (machine-local values: localhost DATABASE_URL / APP_URL, dev
# admin credentials, test toggles). The staging/production items are synced
# to Vercel from .env.tpl instead; this template never reaches a deployment.
# Drift between this file and the 1Password item: pnpm env:check.

# -----------------------------------------------------------------------------
# Database (local PostgreSQL)
# -----------------------------------------------------------------------------
DATABASE_URL="op://Environment Variables/noma-dmrv env local/DATABASE_URL"
DB_POOL_MAX="op://Environment Variables/noma-dmrv env local/DB_POOL_MAX"

# -----------------------------------------------------------------------------
# App URL (localhost dev server)
# -----------------------------------------------------------------------------
NEXT_PUBLIC_APP_URL="op://Environment Variables/noma-dmrv env local/NEXT_PUBLIC_APP_URL"

# -----------------------------------------------------------------------------
# Better Auth + admin bootstrap
# -----------------------------------------------------------------------------
BETTER_AUTH_SECRET="op://Environment Variables/noma-dmrv env local/BETTER_AUTH_SECRET"
ADMIN_EMAIL="op://Environment Variables/noma-dmrv env local/ADMIN_EMAIL"
ADMIN_PASSWORD="op://Environment Variables/noma-dmrv env local/ADMIN_PASSWORD"
ALLOW_SELF_SIGNUP="op://Environment Variables/noma-dmrv env local/ALLOW_SELF_SIGNUP"
# Required true for e2e auth fixtures (Better Auth rate-limits sign-in)
DISABLE_RATE_LIMIT="op://Environment Variables/noma-dmrv env local/DISABLE_RATE_LIMIT"

# -----------------------------------------------------------------------------
# Resend (Email Service)
# -----------------------------------------------------------------------------
RESEND_API_KEY="op://Environment Variables/noma-dmrv env local/RESEND_API_KEY"
RESEND_FROM_EMAIL="op://Environment Variables/noma-dmrv env local/RESEND_FROM_EMAIL"

# -----------------------------------------------------------------------------
# Isometric (sandbox)
# -----------------------------------------------------------------------------
ISOMETRIC_CLIENT_SECRET="op://Environment Variables/noma-dmrv env local/ISOMETRIC_CLIENT_SECRET"
ISOMETRIC_ACCESS_TOKEN="op://Environment Variables/noma-dmrv env local/ISOMETRIC_ACCESS_TOKEN"
ISOMETRIC_ENVIRONMENT="op://Environment Variables/noma-dmrv env local/ISOMETRIC_ENVIRONMENT"
ISOMETRIC_DEMO_PROJECT_ID="op://Environment Variables/noma-dmrv env local/ISOMETRIC_DEMO_PROJECT_ID"
ISOMETRIC_UPLOAD_HOST_ALLOWLIST="op://Environment Variables/noma-dmrv env local/ISOMETRIC_UPLOAD_HOST_ALLOWLIST"

# -----------------------------------------------------------------------------
# Storage (local-fs in dev; only the signing secret is configured)
# -----------------------------------------------------------------------------
STORAGE_SIGNING_SECRET="op://Environment Variables/noma-dmrv env local/STORAGE_SIGNING_SECRET"

# -----------------------------------------------------------------------------
# Geo / Maps (map integration — ADR 0009)
# GEO_PROVIDER=stub serves deterministic fixtures (no keys, no network);
# set it to ors in the 1Password item once the two keys below hold real
# values. Both keys may be empty strings until then — they're optional.
# -----------------------------------------------------------------------------
GEO_PROVIDER="op://Environment Variables/noma-dmrv env local/GEO_PROVIDER"
OPENROUTESERVICE_API_KEY="op://Environment Variables/noma-dmrv env local/OPENROUTESERVICE_API_KEY"
NEXT_PUBLIC_MAPTILER_KEY="op://Environment Variables/noma-dmrv env local/NEXT_PUBLIC_MAPTILER_KEY"
