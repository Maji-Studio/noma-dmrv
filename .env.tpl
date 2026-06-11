# =============================================================================
# noma-dmrv DEPLOYED Environment Variables (1Password Template)
# =============================================================================
# Source of truth for what syncs to Vercel (pnpm env:vercel reads this file;
# staging item -> preview, production item -> production). For machine-local
# values use .env.local.tpl + pnpm env:local instead.

# -----------------------------------------------------------------------------
# Database (PostgreSQL via Drizzle ORM)
# -----------------------------------------------------------------------------
DATABASE_URL="op://Environment Variables/noma-dmrv env staging/DATABASE_URL"

# -----------------------------------------------------------------------------
# App URL (Used for Better Auth and general app links)
# -----------------------------------------------------------------------------
NEXT_PUBLIC_APP_URL="op://Environment Variables/noma-dmrv env staging/NEXT_PUBLIC_APP_URL"

# -----------------------------------------------------------------------------
# Better Auth (Authentication)
# -----------------------------------------------------------------------------
BETTER_AUTH_SECRET="op://Environment Variables/noma-dmrv env staging/BETTER_AUTH_SECRET"

# -----------------------------------------------------------------------------
# Resend (Email Service)
# -----------------------------------------------------------------------------
RESEND_API_KEY="op://Environment Variables/noma-dmrv env staging/RESEND_API_KEY"
RESEND_FROM_EMAIL="op://Environment Variables/noma-dmrv env staging/RESEND_FROM_EMAIL"

# -----------------------------------------------------------------------------
# Admin Configuration
# -----------------------------------------------------------------------------
ADMIN_EMAIL="op://Environment Variables/noma-dmrv env staging/ADMIN_EMAIL"

# -----------------------------------------------------------------------------
# Isometric (Carbon Registry API)
# -----------------------------------------------------------------------------
ISOMETRIC_CLIENT_SECRET="op://Environment Variables/noma-dmrv env staging/ISOMETRIC_CLIENT_SECRET"
ISOMETRIC_ACCESS_TOKEN="op://Environment Variables/noma-dmrv env staging/ISOMETRIC_ACCESS_TOKEN"
# sandbox in the staging 1Password item, production in the production item — the
# sync rewrites the item, not the field, so one line serves both environments.
ISOMETRIC_ENVIRONMENT="op://Environment Variables/noma-dmrv env staging/ISOMETRIC_ENVIRONMENT"

# -----------------------------------------------------------------------------
# Storage (S3-compatible object storage)
# -----------------------------------------------------------------------------
STORAGE_PROVIDER="op://Environment Variables/noma-dmrv env staging/STORAGE_PROVIDER"
STORAGE_BUCKET="op://Environment Variables/noma-dmrv env staging/STORAGE_BUCKET"
STORAGE_REGION="op://Environment Variables/noma-dmrv env staging/STORAGE_REGION"
STORAGE_ACCESS_KEY_ID="op://Environment Variables/noma-dmrv env staging/STORAGE_ACCESS_KEY_ID"
STORAGE_SECRET_ACCESS_KEY="op://Environment Variables/noma-dmrv env staging/STORAGE_SECRET_ACCESS_KEY"

# -----------------------------------------------------------------------------
# Geo / Maps (map integration — ADR 0009)
# Both keys are OPTIONAL: without them the app still runs; CALC/address search
# and the map preview degrade gracefully. OPENROUTESERVICE_API_KEY is
# server-only (geocoding + routing); NEXT_PUBLIC_MAPTILER_KEY is a public,
# domain-locked basemap key. GEO_PROVIDER is not templated — it defaults to
# "ors"; "stub" is for hermetic tests only (.env.test) and is rejected in prod.
# -----------------------------------------------------------------------------
OPENROUTESERVICE_API_KEY="op://Environment Variables/noma-dmrv env staging/OPENROUTESERVICE_API_KEY"
NEXT_PUBLIC_MAPTILER_KEY="op://Environment Variables/noma-dmrv env staging/NEXT_PUBLIC_MAPTILER_KEY"

# -----------------------------------------------------------------------------
# App Configuration
# -----------------------------------------------------------------------------
NODE_ENV=development
