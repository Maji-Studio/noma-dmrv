import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { StorageLocationWithFacility } from '@/data-access/storage-locations';
const preview = vi.hoisted(() => vi.fn(() => ({ data: undefined, error: undefined })));
vi.mock('@/hooks/use-output-stock', () => ({ useOutputStockBalance: preview }));
vi.mock('@/components/ui', () => ({ RowActionsMenu: () => null }));
import { SecondaryFigure } from '@/components/ui/secondary-figure';
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
  it('leads an active output bin with its wet estimate and keeps dry biochar as the secondary figure', async () => {
    preview.mockReturnValue({ data: { beforeDryKg: 90, beforeEstimatedWetKg: 200 }, error: undefined } as never);
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<StorageBinTile bin={{ ...bin, archivedAt: null, type: 'product_bin', productInventory: { formulationNames: [] } } as never} actions={[]} onView={vi.fn()} onReconcile={vi.fn()} />); });
    expect(JSON.stringify(renderer.toJSON())).toContain('200 kg wet mass');
    expect(renderer.root.findByType(SecondaryFigure).props).toMatchObject({ label: 'Dry biochar', value: '90 kg' });
    await act(async () => renderer.unmount());
    preview.mockReturnValue({ data: undefined, error: undefined });
  });
  it('never calls a bin with positive wet stock empty, even when its dry biochar rounds to zero', async () => {
    preview.mockReturnValue({ data: { beforeDryKg: 0, beforeEstimatedWetKg: 3 }, error: undefined } as never);
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<StorageBinTile bin={{ ...bin, archivedAt: null } as never} actions={[]} onView={vi.fn()} onReconcile={vi.fn()} />); });
    const text = JSON.stringify(renderer.toJSON());
    expect(text).toContain('3 kg wet mass');
    expect(text).not.toContain('Empty');
    expect(renderer.root.findByType('article').props.className).not.toContain('opacity-70');
    expect(renderer.root.findByType(SecondaryFigure).props).toMatchObject({ label: 'Dry biochar', value: '0 kg' });
    await act(async () => renderer.unmount());
    preview.mockReturnValue({ data: undefined, error: undefined });
  });
  it('shows no figure while an active output bin is still loading', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<StorageBinTile bin={{ ...bin, archivedAt: null } as never} actions={[]} onView={vi.fn()} onReconcile={vi.fn()} />); });
    const text = JSON.stringify(renderer.toJSON());
    expect(text).not.toMatch(/Not available|Empty|kg/);
    expect(renderer.root.findAllByType(SecondaryFigure)).toHaveLength(0);
    await act(async () => renderer.unmount());
  });
  it('falls back to dry biochar when nothing dates a moisture', async () => {
    preview.mockReturnValue({ data: { beforeDryKg: 90, beforeEstimatedWetKg: null }, error: undefined } as never);
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<StorageBinTile bin={{ ...bin, archivedAt: null } as never} actions={[]} onView={vi.fn()} onReconcile={vi.fn()} />); });
    const text = JSON.stringify(renderer.toJSON());
    expect(text).toContain('90 kg dry biochar');
    expect(text).not.toContain('kg wet');
    expect(text).not.toContain('Not available');
    expect(renderer.root.findAllByType(SecondaryFigure)).toHaveLength(0);
    await act(async () => renderer.unmount());
    preview.mockReturnValue({ data: undefined, error: undefined });
  });
  it('names a feedstock bin\'s stock as wet mass with no dry figure under it', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<StorageBinTile bin={{ ...bin, archivedAt: null, type: 'feedstock_bin', feedstockTypeName: 'Pine chips', feedstockInventory: { currentWetMassKg: 400, feedstockTypes: [] } } as never} actions={[]} onView={vi.fn()} onReconcile={vi.fn()} />); });
    const text = JSON.stringify(renderer.toJSON());
    expect(text).toContain('400 kg wet');
    expect(renderer.root.findAllByType(SecondaryFigure)).toHaveLength(0);
    await act(async () => renderer.unmount());
  });
  it('exposes the bin through one link and leaves the tile without a role or tab stop', async () => {
    const onView = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<StorageBinTile bin={bin} actions={[]} onView={onView} onReconcile={vi.fn()} />); });
    const tile = renderer.root.findByType('article');
    expect(tile.props.role).toBeUndefined();
    expect(tile.props.tabIndex).toBeUndefined();
    expect(tile.props.onKeyDown).toBeUndefined();
    const buttons = renderer.root.findAllByType('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.props['aria-label']).toMatch(/, Fixture bin$/);
    const stopPropagation = vi.fn();
    await act(async () => buttons[0]!.props.onClick({ stopPropagation }));
    expect(onView).toHaveBeenCalledTimes(1);
    expect(stopPropagation).toHaveBeenCalled();
    await act(async () => renderer.unmount());
  });
});
