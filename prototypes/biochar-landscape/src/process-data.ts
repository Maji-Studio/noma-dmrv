import { COMPOSITION, STATION_LAYOUTS, SITE_SIZES } from './composition-state';
import { elevation, siteElevation } from './terrain-height';
import type { Vector3Tuple } from 'three';
export type Variant = 'A' | 'B' | 'C';
export const STEPS: {
    name: string;
    short: string;
    title: string;
    body: string;
    position: Vector3Tuple;
    label: Vector3Tuple;
    material: string;
}[] = [
    { name: 'Feedstock', short: 'Feedstock', title: 'A second life for residues.', body: 'Agricultural residues and wood chips are collected and prepared in the storage yard.', position: [-28, 0, -12], label: [-28, 8.5, -12], material: 'Agricultural residues / Wood chips' },
    { name: 'Feedstock delivery', short: 'Inbound delivery', title: 'Loose material. First journey.', body: 'A loaded tipper carries the prepared feedstock to the receiving area beside the enclosed reactor.', position: [-13, 0, -3], label: [-13, 7, -3], material: 'Loaded tipper / Loose feedstock' },
    { name: 'Pyrolysis', short: 'Pyrolysis', title: 'Heat transforms the residue.', body: 'Inside the enclosed reactor, heat with limited oxygen converts the feedstock into carbon-rich biochar.', position: [-1, 0, -8], label: [-1, 11, -8], material: 'Enclosed reactor / Biochar output' },
    { name: 'Product mixing', short: 'Product mixing', title: 'Two inputs. One soil blend.', body: 'Biochar and compost enter separate hoppers. The paddle mixer combines them before the blend is packed into bulk bags.', position: [17, 0, 0], label: [17, 8, 0], material: 'Biochar + Compost / Paddle mixer' },
    { name: 'Product delivery', short: 'Outbound delivery', title: 'A separate journey to the farm.', body: 'Filled bulk bags travel on a flatbed truck from the mixing area to the farm, ready for application.', position: [12, 0, 18], label: [12, 6.5, 18], material: 'Bulk-bag flatbed / Blended product' },
    { name: 'Farm application', short: 'Farm application', title: 'Carbon becomes part of the soil.', body: 'A tractor and spreader distribute the blend across the crop rows. The cutaway reveals roots and biochar in the soil.', position: [-15, 0, 28], label: [-15, 7, 28], material: 'Tractor + Spreader / Root zone' }
];
STEPS.forEach((stage, i) => { const [x, z] = STATION_LAYOUTS[COMPOSITION][i]; stage.position[0] = stage.label[0] = x; stage.position[2] = stage.label[2] = z; });
STEPS.forEach((stage, i) => { if (COMPOSITION !== 'atlas' && i === 5)
    stage.body = 'A tractor and spreader distribute the blend across the crop rows, returning carbon-rich material to the land.'; const [w, d] = (i === 1 || i === 4) ? [0, 0] : SITE_SIZES[i]; const y = w ? siteElevation(stage.position[0], stage.position[2], w, d) : elevation(stage.position[0], stage.position[2]) + (COMPOSITION === 'atlas' ? 0 : .18); stage.position[1] = y; stage.label[1] += y; });
export const VARIANTS = { A: { name: 'Landscape atlas', title: 'A new life for residues.', eyebrow: '01 / Landscape atlas', description: 'Follow the material from the storage yard to the root zone.' }, B: { name: 'Material journey', title: 'Six steps. One connected story.', eyebrow: '02 / Material journey', description: 'Move through the landscape, one transformation at a time.' }, C: { name: 'Terrain & roots', title: 'Read the land. Reveal the soil.', eyebrow: '03 / Terrain & roots', description: 'A topographic study of the process above and the root zone below.' } };
