import type { PoolConfig } from 'pg';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
// pg lets these query parameters override the URL's host; an override is local
// only when it is a loopback name or a Unix socket directory.
const HOST_OVERRIDE_PARAMS = ['host', 'hostaddr'];

// The test guards in tests/helpers/local-host.ts are stricter on purpose.
function isLoopbackOrSocketHost(value: string): boolean {
  return LOCAL_HOSTS.has(value.replace(/^\[(.*)\]$/, '$1')) || value.startsWith('/');
}

function isLocalUrl(url: URL): boolean {
  return isLoopbackOrSocketHost(url.hostname) &&
    HOST_OVERRIDE_PARAMS.every((param) => url.searchParams.getAll(param).flatMap((value) => value.split(',')).every(isLoopbackOrSocketHost));
}

function parseDatabaseUrl(databaseUrl: string): URL {
  try {
    return new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }
}

export function isLocalDatabaseTarget(databaseUrl: string): boolean {
  return isLocalUrl(parseDatabaseUrl(databaseUrl));
}

export function describeDatabaseTarget(databaseUrl: string): string {
  const url = parseDatabaseUrl(databaseUrl);

  return `host=${url.hostname} port=${url.port || '5432'} user=${decodeURIComponent(url.username)} db=${url.pathname.slice(1)} sslmode=${url.searchParams.get('sslmode') ?? 'not set'}`;
}

export function getPgPoolConfig(databaseUrl: string): PoolConfig {
  const url = parseDatabaseUrl(databaseUrl);
  const isLocal = isLocalUrl(url);

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
export function readCaCert(): string | undefined {
  const raw = process.env.DATABASE_CA_CERT?.trim();
  if (!raw) return undefined;
  return raw.replace(/\\n/g, '\n');
}
