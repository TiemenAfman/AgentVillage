import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { BASIN_DECK, BASIN_FLOOR } from 'shared/quay-basin.mjs';
import { assetParts, part } from './models.js';

// The river's shingle sheet over a continuous sloping bed. No retaining faces:
// the shared height is also the water depth and the ground under the walker's feet.
// Keep this island-local so a neighbour gets exactly the same shoreline.
export function buildQuayBasin(basin, terrain, { groundGeometry = null, makeMaterial = null, meadow = 0x91ad68 } = {}) {
  const group = new THREE.Group();
  group.name = 'quay-basin';
  const bed = [], stone = [], stoneColors = [];
  const quad = (out, a, b, c, d) => out.push(...a, ...b, ...c, ...a, ...c, ...d);
  // Quarter-cell samples round off the waterline and corners without changing the
  // parcel mask. At its outer edge the replacement meets the untouched terrain.
  const point = (x, z) => [x, basin.height(x, z), z];
  for (let z = 0; z < terrain.size; z++) for (let x = 0; x < terrain.size; x++) {
    if (!basin.mask[x + z * terrain.size]) continue;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const px = x - terrain.half + i / 4, pz = z - terrain.half + j / 4;
      quad(bed, point(px, pz), point(px, pz + .25), point(px + .25, pz + .25), point(px + .25, pz));
    }
  }
  for (const r of basin.ramps) {
    const point = (along, side, y) => [r.x + r.dx * along + r.dz * side, y,
      r.z + r.dz * along - r.dx * side];
    const rise = (r.y - BASIN_DECK) / r.steps, run = r.length / r.steps;
    const baked = (asset, along, side, base) => {
      for (const name of assetParts(asset)) {
        const p = part(name);
        for (let i = 0; i < p.positions.length; i += 3) {
          stone.push(...point(along + (p.positions[i + 2] + p.at[2]) * run * 3,
            side + p.positions[i] + p.at[0], base + p.positions[i + 1] + p.at[1]));
        }
        stoneColors.push(...p.colors);
      }
    };
    // Blender supplies dressed treads and coping. Solid cheeks reach into the
    // bed, which stays continuous underneath even when seen from water level.
    for (let i = 0; i < r.steps; i++) {
      const a = -r.length + i * run, b = a + run;
      const y = BASIN_DECK + rise * (i + 1);
      baked('addon_quay_tread', (a + b) / 2, 0, y - .15);
      for (const side of [-1, 1]) {
        baked('addon_quay_coping', (a + b) / 2, side * .46, y);
        const inner = side * .37, outer = side * .55;
        const start = stone.length;
        for (const edge of [inner, outer]) {
          quad(stone, point(a, edge, BASIN_FLOOR - .2), point(b, edge, BASIN_FLOOR - .2),
            point(b, edge, y + .025), point(a, edge, y + .025));
        }
        for (const end of [a, b]) {
          quad(stone, point(end, inner, BASIN_FLOOR - .2), point(end, outer, BASIN_FLOOR - .2),
            point(end, outer, y + .025), point(end, inner, y + .025));
        }
        const c = new THREE.Color(i % 2 ? 0x8f897b : 0x999181);
        for (let j = start; j < stone.length; j += 3) stoneColors.push(c.r, c.g, c.b);
      }
    }
    // Close the foundation at both landings as well as along its cheeks.
    for (const [along, y] of [[-r.length, BASIN_DECK + rise], [0, r.y]]) {
      quad(stone, point(along, -.55, BASIN_FLOOR - .2), point(along, .55, BASIN_FLOOR - .2),
        point(along, .55, y - .01), point(along, -.55, y - .01));
      const c = new THREE.Color(0x999181);
      for (let i = 0; i < 6; i++) stoneColors.push(c.r, c.g, c.b);
    }
  }
  for (const [positions, color, stairs] of [[bed, 0xffffff, false], [stone, 0xffffff, true]]) {
    if (!positions.length) continue;
    let geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const mat = !stairs && makeMaterial ? makeMaterial()
      : new THREE.MeshStandardMaterial({ color, roughness: .95, side: THREE.DoubleSide });
    if (!stairs) {
      const colours = [], coverage = [], uv = [];
      const fallback = new THREE.Color(meadow);
      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i], z = positions[i + 2];
        coverage.push(basin.bankCoverage(x, z));
        // Sample the actual painted terrain, including district tint, beach and
        // meadow mottling. A season colour alone left a rectangular green patch.
        colours.push(...(groundGeometry ? sampleGroundAttribute(groundGeometry, terrain, 'color', x, z)
          : [fallback.r, fallback.g, fallback.b]));
        uv.push(x / 3, z / 3);
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
      geo.setAttribute('bankCoverage', new THREE.Float32BufferAttribute(coverage, 1));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      mat.vertexColors = true;
    }
    if (stairs) {
      geo.setAttribute('color', new THREE.Float32BufferAttribute(stoneColors, 3));
      mat.vertexColors = true;
    }
    if (!stairs) {
      const joined = mergeVertices(geo);
      geo.dispose();
      geo = joined;
    }
    geo.computeVertexNormals();
    if (!stairs && groundGeometry) {
      const normal = geo.attributes.normal, p = geo.attributes.position;
      const n = new THREE.Vector3(), inherited = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), z = p.getZ(i);
        const t = Math.min(1, basin.bankDistance(x, z) / .85);
        inherited.fromArray(sampleGroundAttribute(groundGeometry, terrain, 'normal', x, z));
        n.fromBufferAttribute(normal, i).lerp(inherited, 1 - t * t * (3 - 2 * t)).normalize();
        normal.setXYZ(i, n.x, n.y, n.z);
      }
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

// The ground uses two triangles per cell, not a bilinear patch. Interpolate the
// same triangle so a boundary vertex has exactly the colour and normal next to it.
export function sampleGroundAttribute(geometry, terrain, name, x, z) {
  const gx = Math.max(0, Math.min(terrain.size - 1, Math.floor(x + terrain.half)));
  const gz = Math.max(0, Math.min(terrain.size - 1, Math.floor(z + terrain.half)));
  const u = x + terrain.half - gx, v = z + terrain.half - gz;
  const a = gx + gz * (terrain.size + 1), b = a + 1, c = a + terrain.size + 1, d = c + 1;
  const ids = u + v <= 1 ? [a, b, c] : [d, c, b];
  const weights = u + v <= 1 ? [1 - u - v, u, v] : [u + v - 1, 1 - u, 1 - v];
  const attribute = geometry.attributes[name];
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) out[j] += attribute.array[ids[i] * 3 + j] * weights[i];
  return out;
}
