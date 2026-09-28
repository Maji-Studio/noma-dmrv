// Explicit timed transitions avoid large idle-frame deltas snapping a demand-rendered camera.
import { useEffect, useRef, type ComponentRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { elevation } from './terrain-height';
import { STEPS, type Variant } from './process-data';
type Controls = ComponentRef<typeof OrbitControls>;
const CAMERA_DISTANCE = 170;
const TRAVEL_MS = 1900;
const ADJUST_MS = 950;
const TRAVEL_PULLBACK = .18;
const INITIAL_TARGET = new THREE.Vector3(0, elevation(0, 2), 2);
const ISO_DIRECTION = new THREE.Vector3(1, 1, 1).normalize();
const TOPO_DIRECTION = new THREE.Vector3(1, 1.35, 1).normalize();
type Motion = {
    started: number;
    duration: number;
    fromPosition: THREE.Vector3;
    toPosition: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    fromZoom: number;
    toZoom: number;
    pullback: boolean;
};
function smoothTravel(t: number) { return t * t * t * (t * (t * 6 - 15) + 10); }
function fitZoom(width: number, height: number, present: boolean) { const mobile = width < 700; return Math.max(1.6, Math.min((width - (mobile ? 30 : 110)) / 123, (height - (present ? 110 : mobile ? 320 : 210)) / 82)); }
export function CameraRig({ variant, step, revision, zoomFactor, present, reduced, onReady }: {
    variant: Variant;
    step: number;
    revision: number;
    zoomFactor: number;
    present: boolean;
    reduced: boolean;
    onReady: () => void;
}) {
    const { camera, size, invalidate } = useThree();
    const controls = useRef<Controls>(null);
    const motion = useRef<Motion | null>(null);
    const first = useRef(true);
    const previousStep = useRef(-1);
    useEffect(() => {
        if (!controls.current)
            return;
        const c = camera as THREE.OrthographicCamera;
        const target = step < 0 ? INITIAL_TARGET.clone() : new THREE.Vector3(...STEPS[step].position).add(new THREE.Vector3(0, 2, 0));
        const direction = variant === 'C' ? TOPO_DIRECTION : ISO_DIRECTION;
        const movingPoint = step !== previousStep.current;
        motion.current = { started: performance.now(), duration: first.current || reduced ? 0 : movingPoint ? TRAVEL_MS : ADJUST_MS, fromPosition: c.position.clone(), toPosition: target.clone().addScaledVector(direction, CAMERA_DISTANCE), fromTarget: controls.current.target.clone(), toTarget: target, fromZoom: c.zoom, toZoom: fitZoom(size.width, size.height, present) * (step < 0 ? 1 : 2.5) * zoomFactor, pullback: movingPoint && step >= 0 && previousStep.current >= 0 };
        previousStep.current = step;
        controls.current.enableDamping = false;
        invalidate();
    }, [camera, size.width, size.height, step, variant, revision, zoomFactor, present, reduced, invalidate]);
    useFrame(() => {
        const m = motion.current, orbit = controls.current;
        if (!m || !orbit)
            return;
        const c = camera as THREE.OrthographicCamera;
        const progress = m.duration === 0 ? 1 : Math.min((performance.now() - m.started) / m.duration, 1);
        const eased = smoothTravel(progress);
        orbit.target.lerpVectors(m.fromTarget, m.toTarget, eased);
        c.position.lerpVectors(m.fromPosition, m.toPosition, eased);
        // Briefly widen the view between landmarks to preserve landscape context.
        c.zoom = THREE.MathUtils.lerp(m.fromZoom, m.toZoom, eased) * (1 - (m.pullback ? TRAVEL_PULLBACK * Math.sin(Math.PI * progress) ** 2 : 0));
        c.updateProjectionMatrix();
        orbit.update();
        if (first.current) {
            first.current = false;
            onReady();
        }
        if (progress >= 1) {
            motion.current = null;
            orbit.enableDamping = !reduced;
        }
        else
            invalidate();
    });
    return <OrbitControls ref={controls} makeDefault enableDamping={!reduced} dampingFactor={.12} minPolarAngle={.35} maxPolarAngle={1.35} minZoom={1.5} maxZoom={40} enablePan target={INITIAL_TARGET} onStart={() => { motion.current = null; if (controls.current)
        controls.current.enableDamping = !reduced; }}/>;
}
