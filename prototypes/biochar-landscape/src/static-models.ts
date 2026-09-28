import { STEPS } from './process-data';
import { addFoundation, groundFarm } from './site-foundations';
import { COMPOSITION, STATION_YAWS } from './composition-state';
import { createRemodelledModels, createRemodelledCommons } from './remodelled-models';
import { createFeedstock, createTipper, createFlatbed } from './model-logistics';
import { createReactor, createMixer } from './model-production';
import { createFarmSurface } from './model-farm';
import { createSurroundings } from './model-surroundings';
import { optimizeModel } from './optimize-model';
export function createStaticModels() { const sources = COMPOSITION === 'atlas' ? [createFeedstock, createTipper, createReactor, createMixer, createFlatbed, createFarmSurface].map(factory => factory()) : createRemodelledModels(COMPOSITION); if (COMPOSITION !== 'atlas') {
    addFoundation(sources[0], STEPS[0].position, COMPOSITION === 'circle' ? 13.6 : 14, COMPOSITION === 'circle' ? 13.6 : 11, COMPOSITION === 'circle');
    addFoundation(sources[2], STEPS[2].position, 12.5, 8.7);
    addFoundation(sources[3], STEPS[3].position, 10.8, 9.5);
    groundFarm(sources[5], STEPS[5].position);
} const models = sources.map(optimizeModel); models.forEach((model, i) => model.rotation.y = STATION_YAWS[COMPOSITION][i]); return models; }
export function createStaticSurroundings() { return optimizeModel(COMPOSITION === 'atlas' ? createSurroundings() : createRemodelledCommons(COMPOSITION)); }
