import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const ORIGINAL_ARGV = process.argv;
const mocks = vi.hoisted(() => ({ recalculate: vi.fn(), pool: vi.fn(), end: vi.fn(), select: vi.fn(), bins: vi.fn() }));
vi.mock('pg', () => ({ Pool: class { constructor() { mocks.pool(); } end = mocks.end; } }));
vi.mock('drizzle-orm/node-postgres', () => ({ drizzle: () => ({ select: mocks.select, transaction: (work: (tx: object) => unknown) => work({}) }) }));
vi.mock('@/lib/auth/server', () => ({ requireOrgContext: async () => ({ organizationId: 'org' }) }));
vi.mock('./org-context', () => ({ resolveCliAdminIdentity: async () => ({}), runWithCliOrgContext: (_identity: unknown, work: () => unknown) => work() }));
vi.mock('@/data-access/feedstock-recalculation', () => ({ recalculateFeedstockBin: mocks.recalculate, listFeedstockRecalculationBins: mocks.bins }));
beforeEach(() => {
  vi.resetModules();
  mocks.pool.mockClear();
  mocks.end.mockClear();
  mocks.select.mockReset();
  mocks.recalculate.mockReset();
  mocks.bins.mockReset();
  vi.stubEnv('DATABASE_URL', 'postgresql://localhost/app_template_test');
  process.argv = ['node', 'recalculate-feedstock-allocations.ts'];
});
afterEach(() => { vi.unstubAllEnvs(); process.argv = ORIGINAL_ARGV; });
it('reports safe per-bin failures and continues to later bins', async () => {
  const { DomainError } = await import('@/lib/domain-errors');
  const { SafeError } = await import('@/lib/errors');
  const oldExitCode = process.exitCode;
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const fatal = vi.spyOn(console, 'error').mockImplementation(() => {});
  const bins = ['A', 'B', 'C', 'D'].map(code => ({ id: code, code }));
  mocks.select.mockReturnValueOnce({ from: async () => [{ id: 'org' }] });
  mocks.bins.mockResolvedValue(bins);
  mocks.recalculate.mockRejectedValueOnce(new DomainError('insufficient_stock', 'Safe refusal'))
    .mockRejectedValueOnce(new SafeError('Correct the stock history.'))
    .mockRejectedValueOnce(new Error('private driver detail'))
    .mockResolvedValueOnce({ code: 'D', runsRefused: 0, runsRewritten: 1, keptSentRuns: [] });
  try {
    await import('./recalculate-feedstock-allocations');
    await vi.waitFor(() => expect(mocks.end).toHaveBeenCalledOnce());
    expect(mocks.recalculate).toHaveBeenCalledTimes(4);
    expect(log.mock.calls.map(([line]) => JSON.parse(line))).toEqual([
      expect.objectContaining({ code: 'A', error: 'insufficient_stock' }),
      expect.objectContaining({ code: 'B', error: 'Correct the stock history.' }),
      expect.objectContaining({ code: 'C', error: 'Recalculation failed' }),
      expect.objectContaining({ code: 'D', runsRewritten: 1 }),
    ]);
    expect(JSON.stringify(log.mock.calls)).not.toContain('private driver detail');
    expect(fatal).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  } finally { process.exitCode = oldExitCode; }
});

it('warns about kept Sent allocations without failing and closes the pool', async () => {
  const oldExitCode = process.exitCode;
  process.exitCode = 0;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  mocks.select.mockReturnValueOnce({ from: async () => [{ id: 'org' }] });
  mocks.bins.mockResolvedValue([{ id: 'bin', code: 'B1' }]);
  mocks.recalculate.mockResolvedValue({ runsRefused: 0, keptSentRuns: [{ code: 'PR1', removalCodes: ['RM1'] }, { code: 'PR2', removalCodes: ['RM2'] }] });
  try {
    await import('./recalculate-feedstock-allocations');
    await vi.waitFor(() => expect(mocks.end).toHaveBeenCalledOnce());
    expect(warn).toHaveBeenCalledExactlyOnceWith('Bin B1: kept Sent runs PR1, PR2 (Removals RM1, RM2). Their credit batches keep the old allocation until the Removal is returned.');
    expect(process.exitCode).toBe(0);
  } finally { process.exitCode = oldExitCode; }
});
it('closes the pool and redacts a fatal inventory failure', async () => {
  const oldExitCode = process.exitCode;
  const fatal = vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.select.mockImplementation(() => { throw new Error('private driver detail'); });
  try {
    await import('./recalculate-feedstock-allocations');
    await vi.waitFor(() => expect(fatal).toHaveBeenCalledOnce());
    expect(mocks.end).toHaveBeenCalledOnce();
    expect(JSON.stringify(fatal.mock.calls)).not.toContain('private driver detail');
    expect(process.exitCode).toBe(1);
  } finally { process.exitCode = oldExitCode; }
});

it.each([
  { nodeEnv: 'development', dryRun: false, databaseUrl: 'postgresql://production.example.invalid/app' },
  { nodeEnv: 'development', dryRun: true, databaseUrl: 'postgresql://production.example.invalid/app' },
  { nodeEnv: 'development', dryRun: false, databaseUrl: 'postgresql://localhost/app?host=production.example.invalid' },
  { nodeEnv: 'development', dryRun: false, databaseUrl: 'postgresql://127.0.0.1/app?hostaddr=203.0.113.7' },
])('rejects remote include-sent before opening a pool ($databaseUrl, dryRun=$dryRun)', async ({ nodeEnv, dryRun, databaseUrl }) => {
  const oldExitCode = process.exitCode;
  vi.stubEnv('NODE_ENV', nodeEnv);
  vi.stubEnv('DATABASE_URL', databaseUrl);
  process.argv.push('--include-sent', ...(dryRun ? ['--dry-run'] : []));
  const fatal = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await import('./recalculate-feedstock-allocations');
    await vi.waitFor(() => expect(fatal).toHaveBeenCalledOnce());
    expect(fatal).toHaveBeenCalledWith(expect.stringContaining('--include-sent requires a local database'));
    expect(fatal).toHaveBeenCalledWith(expect.stringContaining('--allow-remote-include-sent'));
    expect(mocks.pool).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.end).not.toHaveBeenCalled();
    expect(mocks.recalculate).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  } finally { process.exitCode = oldExitCode; }
});
it.each([
  { databaseUrl: 'postgresql://127.0.0.1/app_template_test', override: false },
  { databaseUrl: 'postgresql://staging.example.invalid/app', override: true },
])('rejects include-sent in production before opening a pool ($databaseUrl, override=$override)', async ({ databaseUrl, override }) => {
  const oldExitCode = process.exitCode;
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('DATABASE_URL', databaseUrl);
  process.argv.push('--include-sent', ...(override ? ['--allow-remote-include-sent'] : []));
  const fatal = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await import('./recalculate-feedstock-allocations');
    await vi.waitFor(() => expect(fatal).toHaveBeenCalledOnce());
    expect(fatal).toHaveBeenCalledWith(expect.stringContaining('not allowed in production'));
    expect(mocks.pool).not.toHaveBeenCalled();
    expect(mocks.recalculate).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  } finally { process.exitCode = oldExitCode; }
});
it.each([
  { databaseUrl: 'postgresql://localhost/app_template_test', nodeEnv: 'development', override: false, includeSent: true },
  { databaseUrl: 'postgresql://staging.example.invalid/app', nodeEnv: 'development', override: true, includeSent: true },
  { databaseUrl: 'postgresql://staging.example.invalid/app', nodeEnv: 'development', override: false, includeSent: false },
])('allows recalculation for $databaseUrl ($nodeEnv, override=$override, includeSent=$includeSent)', async ({ databaseUrl, nodeEnv, override, includeSent }) => {
  vi.stubEnv('DATABASE_URL', databaseUrl);
  vi.stubEnv('NODE_ENV', nodeEnv);
  if (includeSent) process.argv.push('--include-sent');
  if (override) process.argv.push('--allow-remote-include-sent');
  mocks.select.mockReturnValueOnce({ from: async () => [{ id: 'org' }] });
  mocks.bins.mockResolvedValue([{ id: 'bin', code: 'B1' }]);
  mocks.recalculate.mockResolvedValue({ runsRefused: 0, keptSentRuns: [] });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  await import('./recalculate-feedstock-allocations');
  await vi.waitFor(() => expect(mocks.end).toHaveBeenCalledOnce());
  expect(mocks.pool).toHaveBeenCalledOnce();
  expect(mocks.recalculate).toHaveBeenCalledWith({ organizationId: 'org' }, {}, 'bin', { allowSentRewrite: includeSent });
});
