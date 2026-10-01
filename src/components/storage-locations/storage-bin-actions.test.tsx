import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorageLocationWithFacility } from '@/data-access/storage-locations';

const load = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
const sheetProps = vi.hoisted(() => ({ current: null as null | { state: unknown } }));
vi.mock('@/hooks/use-storage-locations', () => ({ useLoadStorageLocation: () => load }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ error: toastError }) }));
vi.mock('@/components/ui/tooltip', () => ({ Tooltip: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('./bin-reconcile-sheet', () => ({ BinReconcileSheet: () => null }));
vi.mock('./storage-bin-sheet', () => ({
  StorageBinSheet: (props: { state: unknown }) => {
    sheetProps.current = props;
    return null;
  },
}));
import { StorageBinActions } from './storage-bin-actions';

const bin = { id: 'bin-1', name: 'Forestry waste', archivedAt: null } as unknown as StorageLocationWithFacility;

async function click(renderer: ReactTestRenderer, testId: string) {
  const button = renderer.root.find((node) => node.props['data-testid'] === testId && node.type === 'button');
  await act(async () => button.props.onClick());
}

describe('StorageBinActions', () => {
  beforeEach(() => {
    load.mockReset();
    toastError.mockReset();
    sheetProps.current = null;
  });

  it('renders nothing while no bin is selected', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<StorageBinActions storageLocationId="" />); });
    expect(renderer.toJSON()).toBeNull();
  });

  it('loads the selected bin and opens the bin sheet in the clicked mode', async () => {
    load.mockResolvedValue(bin);
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<StorageBinActions storageLocationId="bin-1" />); });
    await click(renderer, 'storage-bin-edit');
    expect(load).toHaveBeenCalledWith('bin-1');
    expect(sheetProps.current?.state).toEqual({ mode: 'edit', entity: bin });
    await click(renderer, 'storage-bin-view');
    expect(sheetProps.current?.state).toEqual({ mode: 'view', entity: bin });
  });

  it('opens an archived bin read-only even from Edit', async () => {
    const archived = { ...bin, archivedAt: new Date() };
    load.mockResolvedValue(archived);
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<StorageBinActions storageLocationId="bin-1" />); });
    await click(renderer, 'storage-bin-edit');
    expect(sheetProps.current?.state).toEqual({ mode: 'view', entity: archived });
  });

  it('reports a failed load without opening the sheet', async () => {
    load.mockRejectedValue(new Error('boom'));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<StorageBinActions storageLocationId="bin-1" />); });
    await click(renderer, 'storage-bin-view');
    expect(toastError).toHaveBeenCalledOnce();
    expect(sheetProps.current?.state).toBeNull();
  });

  it('keeps a submit inside the bin sheets from reaching the entry form', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<StorageBinActions storageLocationId="bin-1" />); });
    const boundary = renderer.root.find((node) => node.type === 'div' && typeof node.props.onSubmit === 'function');
    const stopPropagation = vi.fn();
    boundary.props.onSubmit({ stopPropagation });
    expect(stopPropagation).toHaveBeenCalledOnce();
  });
});
