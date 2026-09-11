// Storage must survive a reload before an automatic recovery is safe to schedule.
export function createRecovery(storage, { maxRetries = 4, stableMs = 60000 } = {}) {
  const key = 'promptholm.canvasRetries';
  let healthyMs = 0;
  let lastFrame = null;
  return {
    reserve() {
      try {
        const count = Number(storage.getItem(key) || 0);
        if (!Number.isInteger(count) || count < 0 || count >= maxRetries) return null;
        storage.setItem(key, String(count + 1));
        if (storage.getItem(key) !== String(count + 1)) return null;
        return count + 1;
      } catch { return null; }
    },
    failed() { healthyMs = 0; lastFrame = null; },
    frame(now, visible) {
      // Hidden tabs and long pauses do not count as successful rendering.
      if (visible && lastFrame !== null) healthyMs += Math.max(0, Math.min(now - lastFrame, 250));
      lastFrame = visible ? now : null;
      if (healthyMs >= stableMs) {
        try { storage.removeItem(key); } catch { /* automatic recovery stays disabled */ }
        healthyMs = 0;
      }
    },
  };
}

export function renderSnapshot(renderer, now) {
  const { render, memory, programs } = renderer.info;
  return {
    atMs: Math.round(now),
    calls: render.calls, triangles: render.triangles, points: render.points, lines: render.lines,
    geometries: memory.geometries, textures: memory.textures, programs: programs?.length || 0,
    width: renderer.domElement.width, height: renderer.domElement.height,
    pixelRatio: renderer.getPixelRatio(), shadows: renderer.shadowMap.enabled,
  };
}
