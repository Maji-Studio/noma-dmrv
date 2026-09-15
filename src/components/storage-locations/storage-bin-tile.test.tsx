import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { StorageLocationWithFacility } from '@/data-access/storage-locations';
const preview = vi.hoisted(() => vi.fn(() => ({ data: undefined, error: undefined })));
vi.mock('@/hooks/use-output-stock', () => ({ useOutputStockPreview: preview }));
vi.mock('@/components/ui', () => ({ RowActionsMenu: () => null }));
import { StorageBinTile } from './storage-bin-tile';

const bin = { id: 'bin', facilityId: 'facility', name: 'Fixture bin', code: 'BIN', type: 'biochar_bin', archivedAt: new Date(),
  biocharInventory: { currentMassKg: 125, dryMassKg: 100, downstreamFormulations: [] }, lastActivity: null } as unknown as StorageLocationWithFacility;

describe('archived storage board tile', () => {
  it('uses hydrated archived stock without requesting a posting preview', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<StorageBinTile bin={bin} actions={[]} onView={vi.fn()} onReconcile={vi.fn()} />); });
    expect(preview).toHaveBeenLastCalledWith(null);
    expect(JSON.stringify(renderer.toJSON())).toContain('100 kg');
    await act(async () => renderer.unmount());
  });
  it('shows unavailable stock without calling it empty or adding a mass unit', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<StorageBinTile bin={{ ...bin, biocharInventory: { ...bin.biocharInventory, dryMassKg: null } }} actions={[]} onView={vi.fn()} onReconcile={vi.fn()} />); });
    const text = JSON.stringify(renderer.toJSON());
    expect(text).toContain('Not available');
    expect(text).not.toContain('Empty');
    expect(text).not.toContain('dry biochar');
    await act(async () => renderer.unmount());
  });
});
