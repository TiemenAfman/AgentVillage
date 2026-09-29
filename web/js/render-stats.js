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

  // Where the calls go, one frame of it, on request: `__renderStats.breakdown()` in the
  // console records the next frame per object and resolves to rows, heaviest first. Every
  // draw goes through `renderBufferDirect` - the colour pass with the scene, the shadow map
  // with `null` - so wrapping it and reading `info` either side attributes each call and its
  // triangles exactly, with nothing re-derived from geometry. Wrapped only while recording.
  let recording = null, want = null;
  const direct = renderer.renderBufferDirect;
  const recorder = function (camera, scene, geometry, material, object, group) {
    const c = info.render.calls, t = info.render.triangles;
    direct.call(this, camera, scene, geometry, material, object, group);
    const pass = scene ? 'colour' : 'shadow';
    const byPass = recording.get(pass);
    const e = byPass.get(object) || { object, calls: 0, triangles: 0 };
    e.calls += info.render.calls - c;
    e.triangles += info.render.triangles - t;
    byPass.set(object, e);
  };

  let interval = 0, work = 0, lastAt = null, startedAt = 0;
  const api = {
    breakdown() {
      return new Promise((resolve) => { want = resolve; });
    },
    // Before anything is drawn this frame.
    begin(now) {
      if (lastAt !== null) {
        const dt = now - lastAt;
        // A hidden tab or a breakpoint is not a slow frame.
        if (dt < 250) interval = interval ? interval + (dt - interval) * EASE : dt;
      }
      lastAt = now;
      startedAt = now;
      info.reset();
      shadow.calls = 0; shadow.triangles = 0;
      if (want && !recording) {
        recording = new Map([['colour', new Map()], ['shadow', new Map()]]);
        renderer.renderBufferDirect = recorder;
      }
    },
    // After the last render call of the frame.
    end(now) {
      if (recording) {
        renderer.renderBufferDirect = direct;
        const rows = [];
        for (const [pass, byPass] of recording) {
          const byLabel = new Map();
          for (const e of byPass.values()) {
            const label = labelOf(e.object);
            const row = byLabel.get(label) || { pass, label, calls: 0, triangles: 0, objects: [] };
            row.calls += e.calls; row.triangles += e.triangles; row.objects.push(e);
            byLabel.set(label, row);
          }
          rows.push(...byLabel.values());
        }
        rows.sort((a, b) => b.triangles - a.triangles || b.calls - a.calls);
        recording = null;
        const done = want; want = null;
        done(rows);
      }
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
  // Console only, and only with ?stats (nothing makes this object without it).
  globalThis.__renderStats = api;
  return api;
}

// What a draw is called in the breakdown: the named ancestors from the scene down, so a
// house reads as the hamlet it stands in rather than as one of three hundred `Mesh`es, then
// what it is. An instanced mesh says how many it drew out of how many it could.
function labelOf(object) {
  const names = [];
  for (let o = object; o && !o.isScene; o = o.parent) if (o.name) names.unshift(o.name);
  const kind = object.isInstancedMesh ? `Instanced ${object.count}/${object.instanceMatrix.count}`
    : object.isSkinnedMesh ? 'Skinned' : object.type;
  const mat = Array.isArray(object.material) ? 'multi' : (object.material?.name || object.material?.type || '');
  return `${names.join('/') || '(unnamed)'} [${kind}${mat ? ' ' + mat : ''}]`;
}

// One line of it, for the readout in the corner.
export function statsLine(s, extra = '') {
  const n = (v) => v.toLocaleString('en-GB');
  return `${n(s.colour.calls)} calls · ${n(s.colour.triangles)} tris`
    + ` | shadow ${n(s.shadow.calls)} calls · ${n(s.shadow.triangles)} tris`
    + ` | ${s.interval.toFixed(1)} ms/frame · ${s.work.toFixed(1)} ms work`
    + ` | ${s.geometries} geo · ${s.textures} tex · ${s.programs} prog${extra}`;
}
