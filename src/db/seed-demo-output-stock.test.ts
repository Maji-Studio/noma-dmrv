import { describe, expect, it, vi } from 'vitest';
import { allocateApplicationShares, massGrams, splitGrams } from '../data-access/delivery-allocation-math';
import { grams, kilograms, planOutputStock, readRational } from '../lib/output-stock';
import { curatedProductSourceAllocations, demoTimestamps, ids } from './seed-demo-facts';
import { buildDemoOutputStock } from './seed-demo-output-stock';

// The existing defaults module imports the application DB; these pure tests need only its tenant constant.
vi.mock('./org-defaults', () => ({ DEC_ORG_ID: 'org_dark_earth_carbon' }));

const GRAMS_PER_KG = 1000;
const sumGrams = (values: (number | string)[]) => values.reduce<bigint>((sum, value) => sum + grams(value), BigInt(0));

describe('curated demo stock facts', () => {
  it('freezes all recipe ingredients and closes each measured blend without inventing intake evidence', () => {
    const facts = buildDemoOutputStock();
    expect(facts.map(f => f.ingredients.length)).toEqual([1, 2, 2]);
    for (const f of facts) {
      const source = curatedProductSourceAllocations.filter(s => s.biocharProductId === f.chain.productId);
      expect(sumGrams(source.map(s => s.allocatedWetMassKg)) + sumGrams(f.ingredients.map(i => i.wetMassKg))).toBe(grams(f.chain.productWetKg));
      expect(sumGrams(source.map(s => s.allocatedDryMassKg)) + sumGrams(f.ingredients.map(i => i.drySolidsKg)))
        .toBe(BigInt(massGrams(f.chain.productWetKg * (1 - f.chain.moisturePercent / 100))));
      for (const ingredient of f.ingredients) {
        expect(BigInt(Math.round(Number(ingredient.wetMassKg) * GRAMS_PER_KG * (1 - ingredient.moisturePercentUsed / 100)))).toBe(grams(ingredient.drySolidsKg));
        expect(ingredient.sourceStorageLocationId).toBeNull();
        expect(ingredient.moistureSourceSnapshot.kind).toBe('synthetic_demo_mass_balance');
      }
      expect(f.composition.ingredients.map(i => i.formulationIngredientId)).toEqual(f.ingredients.map(i => i.formulationIngredientId));
    }
  });

  it('keeps each curated run within its measured dry output and places products after every source completes', () => {
    const outputs = [
      { id: ids.productionRun1, dry: 960.4, end: demoTimestamps.run1End },
      { id: ids.productionRun2, dry: 705.6, end: demoTimestamps.run2End },
      { id: ids.productionRun3, dry: 833, end: demoTimestamps.run3End },
    ];
    for (const run of outputs) {
      const drawn = sumGrams(curatedProductSourceAllocations.filter(s => s.productionRunId === run.id).map(s => s.allocatedDryMassKg));
      expect(drawn).toBeLessThanOrEqual(grams(run.dry));
      for (const f of buildDemoOutputStock()) {
        expect(f.layer.physicalDate >= run.end.toISOString().slice(0, 10)).toBe(true);
        expect(f.chain.deliveryDate.getTime()).toBeGreaterThan(run.end.getTime());
      }
    }
  });

  it('persists balanced movement, layer, and source-run shipment quantities', () => {
    for (const f of buildDemoOutputStock()) {
      expect(sumGrams(f.runs.map(r => r.dryMassKg))).toBe(grams(f.chain.deliveredDryKg));
      expect(f.allocation.dryMassKg).toBe(kilograms(grams(f.chain.deliveredDryKg)));
      expect(grams(f.allocation.wetMassKg!)).toBe(grams(f.chain.deliveredWetKg));
      expect(grams(f.movement.balanceBeforeDryKg!) - grams(f.movement.balanceAfterDryKg!)).toBe(grams(f.chain.deliveredDryKg));
      expect(f.movement.outputDryDeltaKg).toBe(kilograms(-grams(f.chain.deliveredDryKg)));
      expect(readRational(f.allocation.basisSnapshot.solidsKg)).toEqual(planOutputStock([f.layer], f.movement.physicalDate!, {
        kind: 'wet', wetKg: f.chain.deliveredWetKg, moisturePercent: f.chain.moisturePercent,
      }).allocations[0].solidsKg);
    }
  });

  it('closes every remaining product and run gram on the final draw and rejects overdrawing it', () => {
    for (const f of buildDemoOutputStock()) {
      const close = planOutputStock(f.remainingLayers, f.movement.physicalDate!, {
        kind: 'wet', wetKg: f.chain.productWetKg - f.chain.deliveredWetKg, moisturePercent: f.chain.moisturePercent,
      });
      expect(grams(close.drawnDryKg) + grams(f.allocation.dryMassKg)).toBe(grams(f.layer.establishedDryBiocharKg));
      expect(close.remainingLayers[0].remainingSolidsKg?.numerator).toBe(BigInt(0));
      close.allocations[0].runs.forEach((run, index) => {
        expect(grams(run.dryKg) + grams(f.runs[index].dryMassKg)).toBe(grams(f.layer.runs[index].establishedDryKg));
      });
      expect(() => planOutputStock(f.remainingLayers, f.movement.physicalDate!, {
        kind: 'wet', wetKg: f.chain.productWetKg - f.chain.deliveredWetKg + 0.001, moisturePercent: f.chain.moisturePercent,
      })).toThrow('Insufficient exact dry solids');
    }
  });

  it('saves proportional application shares and lets the final application close all truck shares', () => {
    for (const f of buildDemoOutputStock()) {
      expect(sumGrams(f.applications.map(a => a.wetMassKg))).toBe(grams(f.chain.appliedWetTons * GRAMS_PER_KG));
      expect(sumGrams(f.applications.map(a => a.dryMassKg))).toBe(grams(f.chain.appliedDryTons * GRAMS_PER_KG));
      const wet = splitGrams(Number(grams(f.chain.deliveredWetKg)), f.runs.map(r => Number(grams(r.dryMassKg))));
      const saved = f.runs.map((r, i) => ({ deliveryId: f.chain.deliveryId, biocharProductId: f.chain.productId,
        productionRunId: r.productionRunId, dryMassKg: Number(r.dryMassKg), wetMassKg: wet[i] / GRAMS_PER_KG }));
      const used = f.applications.map(a => ({ ...a, dryMassKg: Number(a.dryMassKg), wetMassKg: Number(a.wetMassKg) }));
      const final = allocateApplicationShares(saved, used,
        f.chain.deliveredWetKg - f.chain.appliedWetTons * GRAMS_PER_KG,
        f.chain.deliveredDryKg - f.chain.appliedDryTons * GRAMS_PER_KG);
      final.forEach((share, i) => {
        expect(grams(share.wetMassKg) + grams(used[i].wetMassKg)).toBe(grams(saved[i].wetMassKg));
        expect(grams(share.dryMassKg) + grams(used[i].dryMassKg)).toBe(grams(saved[i].dryMassKg));
      });
    }
  });
});
