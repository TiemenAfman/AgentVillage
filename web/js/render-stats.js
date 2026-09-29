// What one frame costs, split into the shadow pass and the colour pass, for `?stats`.
//
// three.js resets `renderer.info` at the start of every `render()` - *after* the shadow map
// has been drawn - so the readout used to show the colour pass alone, and the shadow pass,
// which draws every caster again from the sun, was invisible to every measurement anybody
// took. Here the automatic reset is turned off, the counters are cleared by hand once per
// frame, and the shadow map's own `render` is wrapped so the part it added can be taken out.
// Only with `?stats`: without it nothing is wrapped and three.js behaves as it always did.
//
// Frame time is two numbers. `interval` is from one frame to the next (what the eye sees,
// capped by vsync); `work` is how long our own `frame()` held the main thread, which is the
// honest number when the GPU is not the bottleneck. Neither is GPU time - that needs
// EXT_disjoint_timer_query, which most browsers hide - so on a machine that is GPU-bound the
// interval is the one that moves.

// A running mean that forgets: the last second or so, at sixty frames.
const EASE = 0.05;

export function createRenderStats(renderer) {
  const info = renderer.info;
  const shadowMap = renderer.shadowMap;
  const inner = shadowMap.render;
  const shadow = { calls: 0, triangles: 0 };
  info.autoReset = false;
  shadowMap.render = function (...args) {
    const c = info.render.calls, t = info.render.triangles;
    inner.apply(this, args);
    shadow.calls += info.render.calls - c;
    shadow.triangles += info.render.triangles - t;
  };

  let interval = 0, work = 0, lastAt = null, startedAt = 0;
  return {
    // Before anything is drawn this frame.
    begin(now) {
      if (lastAt !== null) {
        const dt = now - lastAt;
        // A hidden tab or a breakpoint is not a slow frame.
        if (dt < 5000) interval = interval ? interval + (dt - interval) * EASE : dt;
      }
      lastAt = now;
      startedAt = now;
      info.reset();
      shadow.calls = 0; shadow.triangles = 0;
    },
    // After the last render call of the frame.
    end(now) {
      const w = now - startedAt;
      work = work ? work + (w - work) * EASE : w;
      return {
        colour: { calls: info.render.calls - shadow.calls, triangles: info.render.triangles - shadow.triangles },
        shadow: { ...shadow },
        interval, work,
        geometries: info.memory.geometries, textures: info.memory.textures,
        programs: info.programs ? info.programs.length : 0,
      };
    },
  };
}

// One line of it, for the readout in the corner.
export function statsLine(s, extra = '') {
  const n = (v) => v.toLocaleString('en-GB');
  return `${n(s.colour.calls)} calls · ${n(s.colour.triangles)} tris`
    + ` | shadow ${n(s.shadow.calls)} calls · ${n(s.shadow.triangles)} tris`
    + ` | ${s.interval.toFixed(1)} ms/frame · ${s.work.toFixed(1)} ms work`
    + ` | ${s.geometries} geo · ${s.textures} tex · ${s.programs} prog${extra}`;
}
