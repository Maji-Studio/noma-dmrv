import { expect, it, vi } from 'vitest';
import { DomainError } from '@/lib/domain-errors';
import { SafeError } from '@/lib/errors';
const mocks = vi.hoisted(() => ({ recalculate: vi.fn(), end: vi.fn(), select: vi.fn() }));
vi.mock('node:util', () => ({ parseArgs: () => ({ values: { 'dry-run': false } }) }));
vi.mock('@/db', () => ({ db: { select: mocks.select, transaction: (work: (tx: object) => unknown) => work({}), $client: { end: mocks.end } } }));
vi.mock('@/lib/auth/server', () => ({ requireOrgContext: async () => ({ organizationId: 'org' }) }));
vi.mock('./org-context', () => ({ resolveCliAdminIdentity: async () => ({}), runWithCliOrgContext: (_identity: unknown, work: () => unknown) => work() }));
vi.mock('@/data-access/feedstock-recalculation', () => ({ recalculateFeedstockBin: mocks.recalculate }));
it('reports safe per-bin failures and continues to later bins', async () => {
  const oldExitCode = process.exitCode;
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const fatal = vi.spyOn(console, 'error').mockImplementation(() => {});
  const bins = ['A', 'B', 'C', 'D'].map(code => ({ id: code, code }));
  mocks.select.mockReturnValueOnce({ from: async () => [{ id: 'org' }] })
    .mockReturnValueOnce({ from: () => ({ where: () => ({ orderBy: async () => bins }) }) });
  mocks.recalculate.mockRejectedValueOnce(new DomainError('insufficient_stock', 'Safe refusal'))
    .mockRejectedValueOnce(new SafeError('Correct the stock history.'))
    .mockRejectedValueOnce(new Error('private driver detail'))
    .mockResolvedValueOnce({ code: 'D', runsRefused: 0, runsRewritten: 1 });
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
