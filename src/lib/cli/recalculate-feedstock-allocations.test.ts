import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ recalculate: vi.fn(), end: vi.fn(), select: vi.fn() }));
vi.mock('node:util', () => ({ parseArgs: () => ({ values: { 'dry-run': false } }) }));
vi.mock('pg', () => ({ Pool: class { end = mocks.end; } }));
vi.mock('drizzle-orm/node-postgres', () => ({ drizzle: () => ({ select: mocks.select, transaction: (work: (tx: object) => unknown) => work({}) }) }));
vi.mock('@/lib/auth/server', () => ({ requireOrgContext: async () => ({ organizationId: 'org' }) }));
vi.mock('./org-context', () => ({ resolveCliAdminIdentity: async () => ({}), runWithCliOrgContext: (_identity: unknown, work: () => unknown) => work() }));
vi.mock('@/data-access/feedstock-recalculation', () => ({ recalculateFeedstockBin: mocks.recalculate }));
beforeEach(() => { vi.resetModules(); mocks.end.mockClear(); mocks.select.mockReset(); mocks.recalculate.mockReset(); });
it('reports safe per-bin failures and continues to later bins', async () => {
  const { DomainError } = await import('@/lib/domain-errors');
  const { SafeError } = await import('@/lib/errors');
  const oldExitCode = process.exitCode;
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const fatal = vi.spyOn(console, 'error').mockImplementation(() => {});
  const bins = ['A', 'B', 'C', 'D'].map(code => ({ id: code, code }));
  mocks.select.mockReturnValueOnce({ from: async () => [{ id: 'org' }] })
    .mockReturnValueOnce({ from: () => ({ where: () => ({ orderBy: async () => bins }) }) });
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
  mocks.select.mockReturnValueOnce({ from: async () => [{ id: 'org' }] })
    .mockReturnValueOnce({ from: () => ({ where: () => ({ orderBy: async () => [{ id: 'bin', code: 'B1' }] }) }) });
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
