import { describe, expect, it } from 'vitest';
import { sameReturnAllocationBasis } from './source-basis';

const BASIS = { allocationId: 'allocation', feedstockId: 'intake', wetMassKg: 100, feedstockTypeId: 'wood', storageLocationId: 'bin', facilityId: 'facility', status: 'complete' };

describe('frozen return allocation basis', () => {
  it('ignores JSONB key ordering and allocation ordering', () => {
    const reordered = Object.fromEntries(Object.entries(BASIS).reverse());
    const other = { ...BASIS, allocationId: 'other' };
    expect(sameReturnAllocationBasis([reordered, other], [other, BASIS])).toBe(true);
  });
  it.each(['allocationId', 'feedstockId', 'wetMassKg', 'feedstockTypeId', 'storageLocationId', 'facilityId', 'status'])('detects a changed %s', field => {
    expect(sameReturnAllocationBasis([BASIS], [{ ...BASIS, [field]: 'changed' }])).toBe(false);
  });
  it('fails closed for absent snapshot allocations', () => {
    expect(sameReturnAllocationBasis(undefined, [BASIS])).toBe(false);
  });
});
