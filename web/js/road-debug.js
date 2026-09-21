// web/js/road-debug.js
//
// Debug rendering for the village infrastructure.
// Shows:
//   - roads from village.paths
//   - bridges from village.bridges
//   - town square from village.island.town.paved
//
// This module only visualizes existing layout data.
// It does not generate or modify roads, bridges or the town square.
//

import * as THREE from 'three';

const ROAD_COLOR = 0xffcc00;
const BRIDGE_COLOR = 0x00ccff;
const TOWN_COLOR = 0x66ff66;
const TOWN_CENTRE_COLOR = 0xffffff;

const DEBUG_OFFSET_Y = 0.1;
const CELL_HALF_SIZE = 0.48;

export function createRoadDebug({ scene, terrain, village }) {
  const group = new THREE.Group();
  group.name = 'road-debug';
  group.visible = false;

  scene.add(group);

  let wireframeEnabled = false;

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
    for (const child of [...group.children]) {
      disposeObject(child);
      group.remove(child);
    }
  }

  // ---------------------------------------------------------------------------
  // Cell collection
  // ---------------------------------------------------------------------------

  function roadCells() {
    const cells = [];
    const seen = new Set();

    for (const road of village?.paths || []) {
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

    for (const bridge of village?.bridges || []) {
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
    return village?.island?.town?.paved || [];
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
    const centre = village?.island?.town?.centre;

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
      townCentre: village?.island?.town?.centre || null,
    });

    // Roads
    const roadLines = buildCellLines(
      roads,
      ROAD_COLOR,
      'road-wireframe'
    );

    if (roadLines) {
      group.add(roadLines);
    }

    // Bridges
    const bridgeLines = buildCellLines(
      bridges,
      BRIDGE_COLOR,
      'bridge-wireframe',
      DEBUG_OFFSET_Y + 0.03
    );

    if (bridgeLines) {
      group.add(bridgeLines);
    }

    // Town square
    const squareLines = buildCellLines(
      square,
      TOWN_COLOR,
      'town-square-wireframe',
      DEBUG_OFFSET_Y + 0.02
    );

    if (squareLines) {
      group.add(squareLines);
    }

    // Town centre
    const centreLines = buildTownCentre();

    if (centreLines) {
      group.add(centreLines);
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  function setWireframe(enabled) {
    wireframeEnabled = !!enabled;
    group.visible = wireframeEnabled;

    if (wireframeEnabled) {
      buildWireframe();
    } else {
      clearWireframe();
    }
  }

  function refresh() {
    if (!wireframeEnabled) return;

    buildWireframe();
  }

  function dispose() {
    clearWireframe();
    scene.remove(group);
  }

  return {
    group,
    setWireframe,
    refresh,
    dispose,

    get wireframeEnabled() {
      return wireframeEnabled;
    },
  };
}