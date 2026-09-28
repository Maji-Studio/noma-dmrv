import { REMODELLED, ROUTE_POINTS } from './composition-state';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { StageFocus, MaterialFlow, addWind } from './landscape-life';
import { LandscapeClouds, createFieldDetails } from './landscape-atmosphere';
import { MiniatureLighting } from './miniature-lighting';
import { atlasReady } from './illustrated-atlas';
import { ReactorFire } from './reactor-fire';
import { PaletteTreatment, type PaletteStudy } from './palette-study';
import { prepareStageMaterials } from './station-materials';
import { ShadingTreatment } from './shading-treatment';
import type { ShadingMode } from './shading-state';
import { CameraRig } from './camera-rig';
import { createStaticModels, createStaticSurroundings } from './static-models';
import { applyModelBake, BakedGroundShadows } from './baked-model-lighting';
import * as THREE from 'three';
import { createFarmSoil } from './model-farm';
import { createEcology } from './model-ecology';
import { createTerrain, road, createConveyor } from './terrain';
import { optimizeModel } from './optimize-model';
import { PALETTE } from './model-kit';
import { STEPS, type Variant } from './process-data';
const MODELS = createStaticModels();
const FARM_SOIL = optimizeModel(createFarmSoil());
const TERRAIN = createTerrain(), TOPOGRAPHY = createTerrain(true), ECOLOGY = createEcology();
const WIND = addWind(ECOLOGY);
const FIELD_DETAILS = createFieldDetails();
const ROADS = ROUTE_POINTS.map((points, i) => road(points, i === 0 ? PALETTE.orange : PALETTE.pink));
const CONVEYOR = createConveyor();
const SURROUNDINGS = createStaticSurroundings();
applyModelBake([...MODELS, SURROUNDINGS]);
prepareStageMaterials([...MODELS, FARM_SOIL]);
function RootZone({ explode, reduced }: {
    explode: number;
    reduced: boolean;
}) { const ref = useRef<THREE.Group>(null); const { invalidate } = useThree(); useFrame((_, delta) => { if (!ref.current)
    return; const target = -explode; ref.current.position.y = reduced ? target : THREE.MathUtils.damp(ref.current.position.y, target, 9, Math.min(delta, .05)); if (Math.abs(ref.current.position.y - target) > .002)
    invalidate();
else
    ref.current.position.y = target; }); return <group ref={ref}><primitive object={FARM_SOIL} dispose={null}/></group>; }
function StageLabel({ index, active, onSelect, compact, onHover }: {
    index: number;
    active: boolean;
    onSelect: () => void;
    compact: boolean;
    onHover: (index: number) => void;
}) {
    const stage = STEPS[index];
    return <group position={stage.label}>
 <mesh position={[0, -1.1, 0]}><cylinderGeometry args={[.025, .025, 2.2, 5]}/><meshBasicMaterial color={active ? PALETTE.pink : PALETTE.ink} transparent opacity={.45}/></mesh>
 <Html center zIndexRange={[20, 0]} style={{ pointerEvents: 'auto' }}><button data-category={index < 3 ? "transformation" : "distribution"} className={`landmark ${active ? 'active' : ''} ${compact ? 'compact' : ''}`} onClick={onSelect} onMouseEnter={() => onHover(index)} onMouseLeave={() => onHover(-1)} onFocus={() => onHover(index)} onBlur={() => onHover(-1)} aria-label={`Explore ${stage.name}`}><span className="landmark-number">{String(index + 1).padStart(2, '0')}</span><span className="landmark-name">{stage.name}</span></button></Html>
 </group>;
}
function AtlasReady() { const { invalidate } = useThree(); useEffect(() => { let mounted = true; atlasReady.then(() => { if (mounted)
    invalidate(); }); return () => { mounted = false; }; }, [invalidate]); return null; }
function Scene({ variant, step, onSelect, explode, labels, hovered, onHover, motion, reduced }: {
    variant: Variant;
    step: number;
    onSelect: (step: number) => void;
    explode: number;
    labels: boolean;
    hovered: number;
    onHover: (index: number) => void;
    motion: boolean;
    reduced: boolean;
}) {
    return <>
 <AtlasReady /><Suspense fallback={null}><MiniatureLighting /></Suspense><LandscapeClouds clock={WIND}/><primitive object={FIELD_DETAILS} dispose={null}/><BakedGroundShadows /><StageFocus index={hovered >= 0 ? hovered : step}/><MaterialFlow running={motion && !reduced} wind={WIND}/>
 <primitive object={variant === 'C' ? TOPOGRAPHY : TERRAIN} dispose={null}/><primitive object={SURROUNDINGS} dispose={null}/><primitive object={ECOLOGY} dispose={null}/>{ROADS.map((route, i) => <primitive key={i} object={route} dispose={null}/>)}{!REMODELLED && <primitive object={CONVEYOR} dispose={null}/>}
 {STEPS.map((stage, i) => <group key={i} position={stage.position} onClick={e => { e.stopPropagation(); onSelect(i); }} onPointerOver={e => { e.stopPropagation(); onHover(i); document.body.style.cursor = 'pointer'; }} onPointerOut={() => { onHover(-1); document.body.style.cursor = 'auto'; }}><primitive object={MODELS[i]} dispose={null}/>{i === 2 && <ReactorFire clock={WIND}/>}{i === 5 && !REMODELLED && <RootZone reduced={reduced} explode={variant === 'C' ? explode : 0}/>}</group>)}
 {labels && STEPS.map((_, i) => i === step ? null : <StageLabel key={i} index={i} active={step === i} compact={step >= 0 && step !== i} onSelect={() => onSelect(i)} onHover={onHover}/>)}
 {step === 3 && <><Html position={[STEPS[3].position[0] - 3.3, STEPS[3].position[1] + 5.6, STEPS[3].position[2] - 3.15]} center><span className="material-label">Biochar</span></Html><Html position={[STEPS[3].position[0], STEPS[3].position[1] + 5.6, STEPS[3].position[2] - 3.15]} center><span className="material-label">Compost</span></Html></>}
 </>;
}
export function LandscapeScene(props: {
    shading: ShadingMode;
    variant: Variant;
    step: number;
    onSelect: (step: number) => void;
    revision: number;
    zoomFactor: number;
    present: boolean;
    reduced: boolean;
    explode: number;
    labels: boolean;
    hovered: number;
    onHover: (index: number) => void;
    motion: boolean;
    palette: PaletteStudy;
}) {
    const [ready, setReady] = useState(false);
    return <div className="scene-canvas" aria-label="Interactive 3D landscape of the six-step biochar process"><Canvas orthographic camera={{ position: [100, 100, 100], zoom: 5, near: .1, far: 1000 }} dpr={[1, 1.5]} frameloop="demand" gl={{ antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: false }} fallback={<div className="webgl-fallback">This 3D landscape needs WebGL. Open the HTML in a current browser with graphics acceleration enabled.</div>}>
 <PaletteTreatment palette={props.palette}/><ShadingTreatment mode={props.shading}/><CameraRig {...props} onReady={() => setReady(true)}/><Scene {...props}/>
 </Canvas>{!ready && <div className="loading mono">Building the landscape…</div>}</div>;
}
