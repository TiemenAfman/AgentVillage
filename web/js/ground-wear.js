import { makeSimplex2D, hash32 } from 'shared/rng.mjs';

// One coverage field for yards and paths. Taking the maximum joins footprints
// without alpha stacking, seams at junctions or darker overlapping decals.
export function groundWearField(size, seed, strokes, yards, resolution = Math.min(2048, size * 8)) {
  const data = new Uint8Array(resolution * resolution);
  const half = size / 2, step = size / resolution;
  const noise = makeSimplex2D(hash32(`ground-wear:${seed}`));
  const stamp = (x0, z0, x1, z1, distance, radius, feather, strength) => {
    const a = Math.max(0, Math.floor((x0 + half) / step));
    const b = Math.min(resolution - 1, Math.ceil((x1 + half) / step));
    const c = Math.max(0, Math.floor((z0 + half) / step));
    const d = Math.min(resolution - 1, Math.ceil((z1 + half) / step));
    for (let j = c; j <= d; j++) for (let i = a; i <= b; i++) {
      const x = (i + .5) * step - half, z = (j + .5) * step - half;
      // Broad encroaching grass and smaller nicks in the verge, anchored in world space.
      const rag = noise(x * 2.3, z * 2.3) * .10 + noise(x * 8, z * 8) * .035;
      const t = Math.max(0, Math.min(1, (radius + feather + rag - distance(x, z)) / feather));
      const value = Math.round(255 * strength * t * t * (3 - 2 * t));
      const k = i + j * resolution;
      if (value > data[k]) data[k] = value;
    }
  };
  for (const { points, radius = .28, feather = .42 } of strokes) {
    const pad = radius + feather + .14;
    for (let i = 0; i < Math.max(1, points.length - 1); i++) {
      const a = points[i], b = points[i + 1] || a;
      if (!a) continue;
      const dx = b[0] - a[0], dz = b[1] - a[1], len = dx * dx + dz * dz;
      stamp(Math.min(a[0], b[0]) - pad, Math.min(a[1], b[1]) - pad,
        Math.max(a[0], b[0]) + pad, Math.max(a[1], b[1]) + pad, (x, z) => {
          const t = len ? Math.max(0, Math.min(1, ((x-a[0])*dx+(z-a[1])*dz)/len)) : 0;
          return Math.hypot(x-a[0]-t*dx, z-a[1]-t*dz);
        }, radius, feather, 1);
    }
  }
  for (const { x, z, rx, rz } of yards) {
    const feather = .52, pad = feather + .14;
    // Ellipses break the old square plot outlines. Each uses the same continuous
    // edge noise as the road it meets, so a doorstep reads as part of its lane.
    const px = pad * rx / Math.min(rx,rz), pz = pad * rz / Math.min(rx,rz);
    stamp(x-rx-px, z-rz-pz, x+rx+px, z+rz+pz,
      (px,pz) => (Math.hypot((px-x)/rx,(pz-z)/rz)-1)*Math.min(rx,rz),
      -.12, feather, .93);
  }
  return { data, resolution };
}

// A riverbank is terrain, not a row of paving slabs. Paint its cells into one coverage
// field so adjoining cells become a single shore and the outside edge can fray into the
// grass. Keeping this beside groundWearField gives both surfaces the same resolution,
// edge language and "maximum wins" joining rule.
export function riverBankField(size, seed, cells, resolution = Math.min(2048, size * 8)) {
  const data = new Uint8Array(resolution * resolution);
  const half = size / 2, step = size / resolution;
  const noise = makeSimplex2D(hash32(`river-bank:${seed}`));
  const feather = .38, pad = feather + .12;
  for (const [gx, gz] of cells || []) {
    const cx = gx - half + .5, cz = gz - half + .5;
    const a = Math.max(0, Math.floor((cx - .5 - pad + half) / step));
    const b = Math.min(resolution - 1, Math.ceil((cx + .5 + pad + half) / step));
    const c = Math.max(0, Math.floor((cz - .5 - pad + half) / step));
    const d = Math.min(resolution - 1, Math.ceil((cz + .5 + pad + half) / step));
    for (let j = c; j <= d; j++) for (let i = a; i <= b; i++) {
      const x = (i + .5) * step - half, z = (j + .5) * step - half;
      const dx = Math.max(Math.abs(x - cx) - .5, 0);
      const dz = Math.max(Math.abs(z - cz) - .5, 0);
      const rag = noise(x * 2.1, z * 2.1) * .11 + noise(x * 7.7, z * 7.7) * .035;
      // The small solid margin makes shared cell edges fully opaque. Without it every
      // join would be feathered twice and the old grid would return as pale seams.
      const t = Math.max(0, Math.min(1, (.18 + feather + rag - Math.hypot(dx, dz)) / feather));
      const value = Math.round(255 * t * t * (3 - 2 * t));
      const k = i + j * resolution;
      if (value > data[k]) data[k] = value;
    }
  }
  return { data, resolution };
}

export function dressGroundWear(material, texture, size, THREE, plazaTexture, river = null, quayMask = null) {
  const uniforms = {
    uPlaza: { value: plazaTexture }, uWear: { value: texture }, uWearSize: { value: size },
    uEarth: { value: new THREE.Color(0xcbb58b) },
    uRiverBank: { value: river?.texture || plazaTexture },
    uRiverSheet: river?.sheet || { value: plazaTexture },
    uShingle: { value: new THREE.Color(0x9a8a6a) },
    uQuayMask: { value: quayMask || plazaTexture },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = 'varying vec2 vWearXZ;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nvWearXZ = position.xz;');
    shader.fragmentShader = `varying vec2 vWearXZ;
uniform sampler2D uWear;
uniform sampler2D uPlaza;
uniform sampler2D uRiverBank;
uniform sampler2D uRiverSheet;
uniform sampler2D uQuayMask;
uniform float uWearSize;
uniform vec3 uEarth, uShingle;
float wearHash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float wearNoise(vec2 p) {
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(wearHash(i),wearHash(i+vec2(1,0)),f.x),
    mix(wearHash(i+vec2(0,1)),wearHash(i+vec2(1,1)),f.x),f.y);
}
` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
if(texture2D(uQuayMask,vWearXZ/uWearSize+0.5).r>.5) discard;
#include <color_fragment>`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
float wear = texture2D(uWear, vWearXZ/uWearSize+0.5).r;
float fleck = wearNoise(vWearXZ*42.0);
float coverage = clamp(wear + (fleck-.5)*.16*4.0*wear*(1.0-wear),0.0,1.0);
float mottling = mix(.84,1.08,wearNoise(vWearXZ*3.0));
vec3 earth = uEarth * mottling * mix(.92,1.06,fleck);
diffuseColor.rgb = mix(diffuseColor.rgb,earth,coverage);
// The shingle is part of the ground, so it inherits the terrain normals and never exposes
// the large triangles that a raised, vertex-coloured bank mesh used to show. Its mask is
// one continuous field and its detail sheet only changes brightness, like the field sheet.
float riverBank = texture2D(uRiverBank, vWearXZ/uWearSize+0.5).r;
float riverEdge = clamp(riverBank + (wearNoise(vWearXZ*18.0)-.5)*.13*4.0*riverBank*(1.0-riverBank),0.0,1.0);
vec3 shingleDetail = texture2D(uRiverSheet, vWearXZ*.72).rgb * 1.27;
vec3 shingle = uShingle * shingleDetail * mix(.94,1.06,wearNoise(vWearXZ*5.0));
diffuseColor.rgb = mix(diffuseColor.rgb,shingle,riverEdge);
// Worn limestone setts, with staggered rows and sandy, irregular joints.
float plaza = texture2D(uPlaza,vWearXZ/uWearSize+0.5).r;
if(plaza>.02) {
  vec2 grid=vWearXZ*vec2(5.5,7.5);
  grid.x+=mod(floor(grid.y),2.0)*.5;
  vec2 cell=floor(grid), local=fract(grid)-.5;
  float variation=wearHash(cell);
  vec2 extent=vec2(.395,.375)+vec2(variation-.5,wearHash(cell+19.0)-.5)*.065;
  float rim=length(max(abs(local)-extent,0.0))-.045;
  float aa=max(fwidth(rim),.014);
  float stone=1.0-smoothstep(-aa,aa,rim);
  // The edge loses individual stones into sand before that sand fades to grass.
  float edge=smoothstep(.36+variation*.24,.88,plaza);
  diffuseColor.rgb=mix(diffuseColor.rgb,earth*.72,smoothstep(.40,.90,plaza)*.75);
  vec3 limestone=mix(uEarth,vec3(.49,.46,.38),.55)*mix(.72,1.15,variation);
  limestone*=mix(.95,1.04,fleck);
  float bevel=1.0-smoothstep(-.07,0.0,rim)*.12;
  diffuseColor.rgb=mix(diffuseColor.rgb,limestone*bevel,stone*edge);
}
`);
  };
  material.customProgramCacheKey = () => 'ground-wear-plaza-river-quay-v4';
}
