// web/js/road-debug.js
//
// Debug rendering for the village infrastructure.
// Shows:
//   - roads from village.paths
//   - bridges from village.bridges
//   - town square from village.island.town.paved
//   - an animated no-entry sign over every house the road network cannot reach from the
//     town square, using the exact graph shared/settlerwalk.mjs's setRoads builds a
//     settler (via shared/roads.mjs's reachableFromSquare/houseGate) - never a second,
//     divergent notion of "connected".
//
// This module only visualizes existing layout data.
// It does not generate or modify roads, bridges or the town square.
//

import * as THREE from 'three';
import { reachableFromSquare, houseGate } from 'shared/roads.mjs';

const ROAD_COLOR = 0xffcc00;
const BRIDGE_COLOR = 0x00ccff;
const TOWN_COLOR = 0x66ff66;
const TOWN_CENTRE_COLOR = 0xffffff;

const DEBUG_OFFSET_Y = 0.1;
const CELL_HALF_SIZE = 0.48;
const MARKER_SIZE = 128;
const MARKER_BOB = 0.15;
const MARKER_HOVER = 2.1;      // above the door, clear of the roofline most houses draw at

// One material for every marker, made once and never disposed - the same reasoning as
// nameplate.js's woodMat/postMat: this is a permanent fixture of the module, not state
// that belongs to one createRoadDebug() call.
let markerMaterial = null;
function noRoadMaterial() {
  if (markerMaterial) return markerMaterial;
  const c = document.createElement('canvas');
  c.width = MARKER_SIZE;
  c.height = MARKER_SIZE;
  const g = c.getContext('2d');
  g.font = `${Math.round(MARKER_SIZE * 0.78)}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('\u{1F6AB}', MARKER_SIZE / 2, MARKER_SIZE / 2 + MARKER_SIZE * 0.04);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  markerMaterial = new THREE.SpriteMaterial({ map: tex, transparent: true });
  return markerMaterial;
}

// `village` is a getter, not a snapshot: main.js swaps state.village for a new object on
// every scan (applyVillage), so a plain reference here would draw whatever roads existed
// at boot for ever. `refresh`/`/roads redraw` are worth nothing against data that never
// moves.
export function createRoadDebug({ scene, terrain, village }) {
  const group = new THREE.Group();
  group.name = 'road-debug';
  scene.add(group);

  // Two independently toggleable layers under one parent, because wireframe and
  // connections are separate on/off switches (/roads wireframe, /roads connections) and
  // clearWireframe() must never sweep away a marker it knows nothing about.
  const wireGroup = new THREE.Group();
  wireGroup.name = 'road-debug-wireframe';
  wireGroup.visible = false;
  group.add(wireGroup);

  const marksGroup = new THREE.Group();
  marksGroup.name = 'road-debug-connections';
  marksGroup.visible = false;
  group.add(marksGroup);

  let wireframeEnabled = false;
  let connectionsEnabled = false;

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  function disposeObject(object) {
    object.geometry?.dispose();

    if (Array.isArray(object.material)) {
      for (const material of object.material) {
        material.dispose();
      }
    } else {
      object.material?.dispose();
    }
  }

  function clearWireframe() {
    for (const child of [...wireGroup.children]) {
      disposeObject(child);
      wireGroup.remove(child);
    }
  }

  function clearConnections() {
    for (const child of [...marksGroup.children]) {
      disposeObject(child);
      marksGroup.remove(child);
    }
  }

  // ---------------------------------------------------------------------------
  // Cell collection
  // ---------------------------------------------------------------------------

  function roadCells() {
    const cells = [];
    const seen = new Set();

    for (const road of village()?.paths || []) {
      for (const cell of road.cells || []) {
        const gx = cell[0];
        const gz = cell[1];

        const key = `${gx},${gz}`;

        if (seen.has(key)) continue;

        seen.add(key);
        cells.push([gx, gz]);
      }
    }

    return cells;
  }

  function bridgeCells() {
    const cells = [];
    const seen = new Set();

    for (const bridge of village()?.bridges || []) {
      for (const cell of bridge.cells || []) {
        const gx = cell[0];
        const gz = cell[1];

        const key = `${gx},${gz}`;

        if (seen.has(key)) continue;

        seen.add(key);
        cells.push([gx, gz]);
      }
    }

    return cells;
  }

  function townSquareCells() {
    return village()?.island?.town?.paved || [];
  }

  // ---------------------------------------------------------------------------
  // Create cell line geometry
  // ---------------------------------------------------------------------------

  function buildCellLines(cells, color, name, yOffset = DEBUG_OFFSET_Y) {
    if (!cells.length) return null;

    const positions = [];
    let invalidCells = 0;

    for (const [gx, gz] of cells) {
      const world = terrain.cellWorld(gx, gz);

      if (!Array.isArray(world)) {
        invalidCells++;

        console.error('[road-debug] INVALID WORLD:', {
          gx,
          gz,
          world,
        });

        continue;
      }

      const [x, z] = world;

      if (!Number.isFinite(x) || !Number.isFinite(z)) {
        invalidCells++;

        console.error('[road-debug] INVALID CELL:', {
          gx,
          gz,
          world,
        });

        continue;
      }

      const terrainY = terrain.worldHeight(x, z);

      if (!Number.isFinite(terrainY)) {
        invalidCells++;

        console.error('[road-debug] INVALID HEIGHT:', {
          gx,
          gz,
          world: [x, z],
          terrainY,
        });

        continue;
      }

      const y = terrainY + yOffset;
      const h = CELL_HALF_SIZE;

      positions.push(
        // Top
        x - h, y, z - h,
        x + h, y, z - h,

        // Right
        x + h, y, z - h,
        x + h, y, z + h,

        // Bottom
        x + h, y, z + h,
        x - h, y, z + h,

        // Left
        x - h, y, z + h,
        x - h, y, z - h,
      );
    }

    if (!positions.length) {
      return null;
    }

    const geometry = new THREE.BufferGeometry();

    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3)
    );

    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });

    const lines = new THREE.LineSegments(
      geometry,
      material
    );

    lines.name = name;
    lines.renderOrder = 1000;

    console.log('[road-debug] layer:', {
      name,
      cells: cells.length,
      invalidCells,
      positions: positions.length,
    });

    return lines;
  }

  // ---------------------------------------------------------------------------
  // Town centre marker
  // ---------------------------------------------------------------------------

  function buildTownCentre() {
    const centre = village()?.island?.town?.centre;

    if (!centre) return null;

    const [gx, gz] = centre;
    const world = terrain.cellWorld(gx, gz);

    if (!Array.isArray(world)) return null;

    const [x, z] = world;

    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      return null;
    }

    const terrainY = terrain.worldHeight(x, z);

    if (!Number.isFinite(terrainY)) {
      return null;
    }

    const y = terrainY + DEBUG_OFFSET_Y + 0.01;

    const geometry = new THREE.BufferGeometry();

    const size = 0.25;

    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([
        x - size, y, z,
        x + size, y, z,

        x, y, z - size,
        x, y, z + size,
      ], 3)
    );

    const material = new THREE.LineBasicMaterial({
      color: TOWN_CENTRE_COLOR,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });

    const lines = new THREE.LineSegments(
      geometry,
      material
    );

    lines.name = 'town-square-centre';
    lines.renderOrder = 1002;

    return lines;
  }

  // ---------------------------------------------------------------------------
  // Build complete debug view
  // ---------------------------------------------------------------------------

  function buildWireframe() {
    clearWireframe();

    const roads = roadCells();
    const bridges = bridgeCells();
    const square = townSquareCells();

    console.log('[road-debug] infrastructure:', {
      roads: roads.length,
      bridges: bridges.length,
      townSquare: square.length,
      townCentre: village()?.island?.town?.centre || null,
    });

    // Roads
    const roadLines = buildCellLines(
      roads,
      ROAD_COLOR,
      'road-wireframe'
    );

    if (roadLines) {
      wireGroup.add(roadLines);
    }

    // Bridges
    const bridgeLines = buildCellLines(
      bridges,
      BRIDGE_COLOR,
      'bridge-wireframe',
      DEBUG_OFFSET_Y + 0.03
    );

    if (bridgeLines) {
      wireGroup.add(bridgeLines);
    }

    // Town square
    const squareLines = buildCellLines(
      square,
      TOWN_COLOR,
      'town-square-wireframe',
      DEBUG_OFFSET_Y + 0.02
    );

    if (squareLines) {
      wireGroup.add(squareLines);
    }

    // Town centre
    const centreLines = buildTownCentre();

    if (centreLines) {
      wireGroup.add(centreLines);
    }
  }

  // ---------------------------------------------------------------------------
  // Connections: an animated no-entry sign over every house the road network
  // cannot reach from the town square.
  // ---------------------------------------------------------------------------

  function buildConnections() {
    clearConnections();
    const v = village();
    if (!v) return;
    const size = terrain.size;
    const reachable = reachableFromSquare(v, size);
    const material = noRoadMaterial();
    let disconnected = 0;
    let houses = 0;
    for (const b of v.buildings || []) {
      if (!b.plot || b.kind !== 'house' || !b.door) continue;
      houses++;
      const gate = houseGate(v, size, b.door);
      if (gate != null && reachable.has(gate)) continue;    // connected
      disconnected++;
      const world = terrain.cellWorld(b.door[0], b.door[1]);
      if (!Array.isArray(world)) continue;
      const [x, z] = world;
      if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
      const terrainY = terrain.worldHeight(x, z);
      if (!Number.isFinite(terrainY)) continue;
      const baseY = terrainY + MARKER_HOVER;

      const sprite = new THREE.Sprite(material);
      sprite.scale.set(0.9, 0.9, 1);
      sprite.position.set(x, baseY, z);
      sprite.renderOrder = 2000;
      sprite.name = `no-road:${b.id}`;
      // A per-sprite phase, not a shared clock, so a row of marked houses does not bob in
      // lockstep - onBeforeRender is free: three.js already calls it every frame this
      // sprite is in the render path, no hook into main.js's own loop required.
      const phase = Math.random() * Math.PI * 2;
      sprite.onBeforeRender = () => {
        sprite.position.y = baseY + Math.sin(performance.now() / 500 + phase) * MARKER_BOB;
      };
      marksGroup.add(sprite);
    }

    console.log('[road-debug] connections:', { houses, disconnected });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  function setWireframe(enabled) {
    wireframeEnabled = !!enabled;
    wireGroup.visible = wireframeEnabled;

    if (wireframeEnabled) {
      buildWireframe();
    } else {
      clearWireframe();
    }
  }

  function setConnections(enabled) {
    connectionsEnabled = !!enabled;
    marksGroup.visible = connectionsEnabled;

    if (connectionsEnabled) {
      buildConnections();
    } else {
      clearConnections();
    }
  }

  // Called whenever the village the two layers draw from has actually changed - not on a
  // timer, so a house that gains a road loses its mark within the same update that drew
  // the road, not on the next time somebody happens to reopen the debug view.
  function refresh() {
    if (wireframeEnabled) buildWireframe();
    if (connectionsEnabled) buildConnections();
  }

  function dispose() {
    clearWireframe();
    clearConnections();
    scene.remove(group);
  }

  return {
    group,
    setWireframe,
    setConnections,
    refresh,
    dispose,

    get wireframeEnabled() {
      return wireframeEnabled;
    },

    get connectionsEnabled() {
      return connectionsEnabled;
    },
  };
}