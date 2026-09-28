import { useLayoutEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SHADING_STUDIES, SHADING_UNIFORMS, type ShadingMode } from './shading-state';
const STUDY = { edgeAngle: 28, wireInk: '#536357', hybridInk: '#394b3c', wireOpacity: .65, hybridOpacity: .24 };
const PATCH = 'maji-shading-study-v3';
const DECLARATIONS = `uniform float uShadingMode;
varying vec3 vStudyPosition;
float studyDots(vec3 worldPoint,vec3 worldNormal,float density){
 vec3 n=abs(worldNormal);vec2 plane=n.y>=max(n.x,n.z)?worldPoint.xz:(n.x>n.z?worldPoint.yz:worldPoint.xy);
 vec2 point=plane*2.;vec2 footprint=fwidth(point);
 float distanceToDot=length(fract(point)-.5);float radius=sqrt(clamp(density,0.,1.))*.46;
 float aa=max(length(footprint)*.35,.025);
 float resolvedDot=1.-smoothstep(radius-aa,radius+aa,distanceToDot);
 // Subpixel dots integrate to their disk area instead of washing every face to half ink.
 float coverage=3.14159265*radius*radius;
 float minification=smoothstep(.45,1.1,max(footprint.x,footprint.y));
 return mix(resolvedDot,coverage,minification);
}
`;
function prepareMaterial(material: THREE.MeshStandardMaterial) {
    if (material.userData.shadingPrepared)
        return;
    material.userData.shadingPrepared = true;
    const before = material.onBeforeCompile, cache = material.customProgramCacheKey();
    const station = material.userData.fullColorStation === true;
    material.onBeforeCompile = (shader, renderer) => {
        before.call(material, shader, renderer);
        const visibility = shader.fragmentShader.includes('varying vec2 vVisibility') ? 'vVisibility' : 'vec2(1.)';
        Object.assign(shader.uniforms, SHADING_UNIFORMS);
        shader.vertexShader = 'varying vec3 vStudyPosition;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `vec4 studyWorld=vec4(transformed,1.);
#ifdef USE_INSTANCING
 studyWorld=instanceMatrix*studyWorld;
#endif
 vStudyPosition=(modelMatrix*studyWorld).xyz;
 #include <project_vertex>`);
        shader.fragmentShader = `const bool fullColorStation=${station ? 'true' : 'false'};\n` + DECLARATIONS + shader.fragmentShader;
        // Neutral studies change albedo before physical lighting; the bake remains in the lighting path.
        shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `if(!fullColorStation&&uShadingMode>1.5&&uShadingMode<2.5)diffuseColor.rgb=vec3(.92,.94,.89);
 if(!fullColorStation&&uShadingMode>3.5&&uShadingMode<4.5)diffuseColor.rgb=vec3(.86,.84,.79);
 #include <roughnessmap_fragment>`);
        shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
 vec3 studyNormal=inverseTransformDirection(normal,viewMatrix);
 float studyFacing=dot(studyNormal,normalize(vec3(-85.,44.5,-52.)));
 vec2 studyVisibility=${visibility};
 if(uShadingMode>.5&&uShadingMode<1.5){
  float lightBand=mix(.77,1.06,step(.15,studyFacing));
  outgoingLight=diffuseColor.rgb*lightBand*mix(.91,1.,studyVisibility.x);
 }else if(uShadingMode>1.5&&uShadingMode<2.5){
  outgoingLight=(fullColorStation?diffuseColor.rgb:vec3(.92,.94,.89))*mix(.83,1.,smoothstep(-.5,.8,studyFacing))*mix(.87,1.,studyVisibility.x);
 }else if(uShadingMode>2.5&&uShadingMode<3.5){
  outgoingLight=mix(outgoingLight,diffuseColor.rgb*mix(.84,1.04,smoothstep(-.4,.7,studyFacing)),.32);
 }else if(uShadingMode>4.5){
  float pigment=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
  vec3 paper=vec3(.87,.84,.72),sage=vec3(.40,.49,.27),ink=vec3(.075,.13,.073);
  vec3 printBase=mix(sage,paper,smoothstep(.15,.64,pigment));
  float shadow=clamp((1.-studyVisibility.x)*.60+(1.-studyVisibility.y)*.26+(1.-smoothstep(-.45,.75,studyFacing))*.28,0.,1.);
  float dots=studyDots(vStudyPosition,studyNormal,shadow);
  outgoingLight=fullColorStation?mix(outgoingLight,diffuseColor.rgb*.18,dots*.42):mix(printBase,ink,dots*.82);
 }
 #include <opaque_fragment>`);
    };
    material.customProgramCacheKey = () => `${cache}-${PATCH}-${station ? 'station' : 'environment'}`;
    material.needsUpdate = true;
}
function prepareEdges(scene: THREE.Scene) {
    const batches = new Map<THREE.Object3D, {
        parts: THREE.BufferGeometry[];
        source: THREE.Material;
    }>();
    // Snapshot the source objects before adding overlays; each parent receives one draw call.
    const objects: THREE.Object3D[] = [];
    scene.traverse(object => objects.push(object));
    for (const object of objects) {
        if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh || object.userData.shadingEdges)
            continue;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        const source = materials.find(material => material instanceof THREE.MeshStandardMaterial);
        if (!source || !object.parent || object.parent.userData.shadingEdgeOverlay)
            continue;
        if (!object.geometry.getAttribute('normal') || !source.customProgramCacheKey().includes('field-sketch'))
            continue;
        const edges = new THREE.EdgesGeometry(object.geometry, STUDY.edgeAngle);
        if (!edges.getAttribute('position').count) {
            edges.dispose();
            continue;
        }
        object.updateMatrix();
        edges.applyMatrix4(object.matrix);
        const batch = batches.get(object.parent) ?? { parts: [], source };
        batch.parts.push(edges);
        batches.set(object.parent, batch);
    }
    for (const [parent, batch] of batches) {
        const geometry = mergeGeometries(batch.parts);
        batch.parts.forEach(part => part.dispose());
        if (!geometry)
            continue;
        const material = new THREE.LineBasicMaterial({ color: STUDY.wireInk, transparent: true, opacity: STUDY.wireOpacity, depthTest: true, depthWrite: false, toneMapped: false });
        material.customProgramCacheKey = () => `${PATCH}-edges-${batch.source.uuid}`;
        const overlay = new THREE.LineSegments(geometry, material);
        overlay.name = 'Cached architectural edges';
        overlay.userData.shadingEdges = true;
        overlay.raycast = () => { };
        overlay.renderOrder = 2;
        overlay.visible = false;
        parent.add(overlay);
        parent.userData.shadingEdgeOverlay = overlay;
    }
}
export function ShadingTreatment({ mode }: {
    mode: ShadingMode;
}) {
    const { scene, invalidate } = useThree();
    useLayoutEffect(() => {
        SHADING_UNIFORMS.uShadingMode.value = SHADING_STUDIES[mode].id;
        const materials = new Set<THREE.Material>();
        scene.traverse(object => { const material = (object as THREE.Mesh).material; if (material)
            for (const mat of Array.isArray(material) ? material : [material])
                materials.add(mat); });
        materials.forEach(material => { if (material instanceof THREE.MeshStandardMaterial)
            prepareMaterial(material); });
        prepareEdges(scene);
        scene.traverse(object => {
            if (object.userData.shadingEdges) {
                object.visible = mode === 'wire' || mode === 'hybrid';
                const mat = (object as THREE.LineSegments).material as THREE.LineBasicMaterial;
                mat.color.set(mode === 'wire' ? STUDY.wireInk : STUDY.hybridInk);
                mat.opacity = mode === 'wire' ? STUDY.wireOpacity : STUDY.hybridOpacity;
            }
            else if (object instanceof THREE.Line && object.material instanceof THREE.LineBasicMaterial && object.material.customProgramCacheKey().includes('pencil')) {
                if (object.userData.shadingOriginalVisible === undefined)
                    object.userData.shadingOriginalVisible = object.visible;
                object.visible = mode === 'original' && object.userData.shadingOriginalVisible;
            }
        });
        invalidate();
    }, [mode, scene, invalidate]);
    return null;
}
