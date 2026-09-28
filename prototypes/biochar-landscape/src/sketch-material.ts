// Matte pigment with offline ambient and directional visibility.
import * as THREE from 'three';
const PIGMENT_GLSL = `
varying vec3 vSketchPosition;
float sketchHash(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
float sketchNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(sketchHash(i),sketchHash(i+vec3(1,0,0)),f.x),mix(sketchHash(i+vec3(0,1,0)),sketchHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(sketchHash(i+vec3(0,0,1)),sketchHash(i+vec3(1,0,1)),f.x),mix(sketchHash(i+vec3(0,1,1)),sketchHash(i+vec3(1,1,1)),f.x),f.y),f.z);}
`;
export function applySketch(material: THREE.MeshStandardMaterial, foliage = false) {
    material.roughness = 1;
    material.metalness = 0;
    // Use the same AgX response as the miniature environment lighting.
    material.toneMapped = true;
    material.onBeforeCompile = shader => {
        shader.vertexShader = 'attribute vec2 bakedVisibility; varying vec2 vVisibility; varying vec3 vSketchPosition;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `vVisibility=bakedVisibility; vec4 sketchPoint=vec4(transformed,1.);
 #ifdef USE_INSTANCING
 sketchPoint=instanceMatrix*sketchPoint;
 #endif
 vSketchPosition=(modelMatrix*sketchPoint).xyz;
 #include <project_vertex>`);
        shader.fragmentShader = 'varying vec2 vVisibility;\n' + PIGMENT_GLSL + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
 float wash=sketchNoise(vSketchPosition*${foliage ? '2.4' : '1.8'});
 float fleck=sketchNoise(vSketchPosition*17.);
 diffuseColor.rgb*=mix(${foliage ? '.60,1.18' : '.94,1.03'},wash);
 diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.96,.97,.92),${foliage ? '.13' : '.025'}*smoothstep(.58,.82,wash));
 diffuseColor.rgb*=1.-${foliage ? '.15' : '.055'}*smoothstep(.55,.8,fleck);`);
        shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
 reflectedLight.indirectDiffuse*=mix(.30,1.,vVisibility.x);
 reflectedLight.indirectSpecular*=mix(.45,1.,vVisibility.x);
 reflectedLight.directDiffuse*=mix(.12,1.,vVisibility.y);
 reflectedLight.directSpecular*=vVisibility.y;`);
    };
    material.customProgramCacheKey = () => `maji-field-sketch-${foliage ? 'leaves' : 'solid'}-4`;
    return material;
}
export function pencilEdges() {
    const material = new THREE.LineBasicMaterial({ color: '#494a40', transparent: true, opacity: .07 });
    material.onBeforeCompile = shader => {
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
 transformed+=vec3(sin(position.y*9.+position.z*7.),sin(position.x*8.+position.z*5.),sin(position.x*6.+position.y*9.))*.009;`);
        shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `diffuseColor.a*=.58+.42*sin(gl_FragCoord.x*.71+gl_FragCoord.y*.39)*sin(gl_FragCoord.y*.93);
 #include <opaque_fragment>`);
    };
    material.customProgramCacheKey = () => 'maji-pencil-lines-1';
    return material;
}
