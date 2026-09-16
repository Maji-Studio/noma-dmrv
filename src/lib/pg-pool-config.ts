import type { PoolConfig } from 'pg';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function parseDatabaseUrl(databaseUrl: string): URL {
  try {
    return new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }
}

export function isLocalDatabaseTarget(databaseUrl: string): boolean {
  return LOCAL_HOSTS.has(parseDatabaseUrl(databaseUrl).hostname);
}

export function describeDatabaseTarget(databaseUrl: string): string {
  const url = parseDatabaseUrl(databaseUrl);

  return `host=${url.hostname} port=${url.port || '5432'} user=${decodeURIComponent(url.username)} db=${url.pathname.slice(1)} sslmode=${url.searchParams.get('sslmode') ?? 'not set'}`;
}

export function getPgPoolConfig(databaseUrl: string): PoolConfig {
  const url = parseDatabaseUrl(databaseUrl);
  const isLocal = LOCAL_HOSTS.has(url.hostname);

  // pg 8.18 derives ssl behavior from sslmode in the connection string and can
  // override explicit ssl options. Strip it so the pool config stays in control.
  url.searchParams.delete('sslmode');

  const allowUnverifiedSsl = process.env.PG_ALLOW_UNVERIFIED_SSL === 'true';
  const caCert = readCaCert();

  return {
    connectionString: url.toString(),
    ssl: isLocal
      ? false
      : caCert
        ? { ca: caCert, rejectUnauthorized: true }
        : allowUnverifiedSsl
          ? { rejectUnauthorized: false }
          : true,
  };
}

/**
 * Managed Postgres providers (DigitalOcean, for one) sign with a private CA
 * that Node does not trust by default. Pinning the provider's CA keeps full
 * verification on, unlike PG_ALLOW_UNVERIFIED_SSL. Secret stores often keep
 * the PEM on one line with literal "\n" escapes, so those are restored.
 */
function readCaCert(): string | undefined {
  const raw = process.env.DATABASE_CA_CERT?.trim();
  if (!raw) return undefined;
  return raw.replace(/\\n/g, '\n');
}
