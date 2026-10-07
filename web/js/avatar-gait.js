// Distances are in island units. A planted foot travels backwards by exactly the
// distance the body advances; cadence follows distance, including partial input.
// The Traveller's speeds, and every caller's that does not ask a body (the studio, villagers).
export const WALK_SPEED = .65;
export const RUN_SPEED = 1.10;
export const CROUCH_SPEED = .30;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (v) => v * v * (3 - 2 * v);

// How a body walks, runs and sprints (Plans/tweede-avonturier.md). Shift with breath in the
// pool is a sprint, Shift with the pool spent is a run - the jog a body keeps up for as long as
// it likes - and no Shift a walk (walk.js). `cycle` is the distance of one full stride (two
// steps), `stance` the share of it a foot is planted - under a half is a run with a flight
// phase - `lift` how high a swinging foot clears the ground, `kick` the extra lift early in
// the swing that folds a runner's heel up behind him, `drop` how far the hips sink under a
// planted leg and `bounce` how far a runner rises and falls through each step (lowest over the
// planted foot, highest in the air). The rest is the upper body, read by classic-avatar.js:
// `lean` forward, `twist` of the shoulders against the hips, `arm` the swing of each arm at
// the end of a stride (`armForward` the share of it in front: a runner drives the elbow back
// and brings the fist up only to the chest - swung as far forward, the bent arm reached out in
// front of him like somebody grabbing), `elbow` how bent the free arms are and `pump` how much
// more as the arm comes forward (and half that less as it goes back), `head` how much of
// the lean the head takes back so the eyes stay on the road. Each is [walk, run, sprint],
// blended by how far into a run and into a sprint the body is (mixOf).
//
// The Traveller's walk and run are the numbers this file always had, so he walks and jogs
// exactly as before; `arm`, `elbow` and `twist` null are his old formulas in
// classic-avatar.js. His sprint is his run on a longer stride: his legs are short (0.17), and
// a planted foot reaches no further than 0.1 either side of his hip.
export const GAITS = {
  traveller: {
    walk: WALK_SPEED, run: RUN_SPEED, sprint: 1.6,
    cycle: [.29, .38, .55], stance: [.60, .46, .36], lift: [.026, .040, .05], kick: [0, 0, .03],
    drop: [.030, .041, .041], bounce: [.0015, .0015, .0015], runBounce: false,
    lean: [0, .035, .09], twist: null, arm: null, elbow: null, head: [0, 0, 0], leanAtHip: false,
  },
  // The Adventurer: a game hero's walk, run and sprint, sized to his longer legs. His leg is
  // 0.212 from hip to ankle, so a foot planted h either side of the hip needs the hips that much
  // lower: 0.212 - sqrt(0.212^2 - h^2), the `drop` at touch-down (drop less the bounce there).
  // Short of it the leg locks straight and the planted foot slides (tests/sprint-walk.test.mjs).
  // The walk is Mixamo's Walking, measured by scripts/measure-mixamo.py and scaled by the leg:
  // a stride of 2.08 legs (0.44) at 2.0 legs a second (0.44, 2 steps a second), the torso
  // upright, the arms 29 degrees back and 13 forward with the elbow from 24 to 49 as the arm
  // comes forward, the heel up behind to 0.21 of a leg after toe-off and the hips rising and
  // falling 0.09 of a leg. Its foot rolls heel to toe and ours is held level, so the stance is
  // longer than Mixamo's flat foot (0.38) and the stride planted a little less: 0.22 (h 0.11,
  // drop 0.031 at touch-down). The run plants 0.187 and the sprint 0.198 - a short stance and a
  // long flight, which is what lets a runner's hips stay high: at 0.34 of stance and 0.05 of drop
  // he ran crouched. The run and the sprint are played off Mixamo's clips by distance (classic-
  // avatar.js withClips: their strides, 0.63 and 0.89 on this leg), so their speeds below only set
  // the cadence and never slide a foot: 1.8 is 5.7 steps a second, 2.7 is 6.1 - the keeper asked
  // twice for faster than the 1.35 and 2.0 these were, which were already faster than Mixamo's own
  // 0.90 and 1.41. The procedural cycles here are what a run without its clip would use.
  athlete: {
    walk: .44, run: 1.8, sprint: 2.7,
    cycle: [.44, .72, .9], stance: [.5, .26, .22], lift: [.012, .05, .06], kick: [.05, .075, .11],
    drop: [.031, .024, .026], bounce: [.007, .006, .004], runBounce: true,
    lean: [0, .22, .32], twist: [.04, .1, .13], arm: [.5, .8, 1.05], armForward: [.45, .6, .6],
    elbow: [.42, 1.45, 1.45], pump: [.45, .45, .55], head: [0, .55, .6], leanAtHip: true,
    // Walk, run, sprint, idle and jumps are Mixamo's (web/js/gait-clips.js); the numbers above are
    // what is blended out of and into them, and their speeds and strides are the clips' own.
    clips: true,
  },
};
export const gaitOf = (name) => GAITS[name] || GAITS.traveller;
// [walk, run, sprint] at `run` (0 walk .. 1 run) and `sprint` (0 run .. 1 sprint).
export const mixOf = (v, run, sprint = 0) => v[0] + (v[1] - v[0]) * run + (v.length > 2 ? (v[2] - v[1]) * sprint : 0);
// The speed a body is going at, as a sprint share: what a page that is only told "running"
// (a peer, through FLAG_RUNNING) reads off how fast it moves. Below the middle of run and
// sprint is a run, above it a sprint.
export const sprintAt = (g, speed) => (speed > (g.run + g.sprint) / 2 ? 1 : 0);

export function solveLeg(z, down, upper, lower) {
  const length = clamp(Math.hypot(z, down), Math.abs(upper-lower)+1e-6, (upper+lower)*.9999);
  const knee = Math.acos(clamp((length*length-upper*upper-lower*lower)/(2*upper*lower),-1,1));
  const hip = Math.atan2(-z, down) - Math.atan2(lower*Math.sin(knee), upper+lower*Math.cos(knee));
  return { hip, knee, ankle: -hip-knee };
}

export function createGait(hipY, kneeY, ankleY, profile = GAITS.traveller) {
  let phase = 0, blend = 0, run = 0, sprint = 0;
  const upper = hipY-kneeY, lower = kneeY-ankleY;
  const g = profile;
  return {
    update(distance, pose, dt) {
      const active = !!(pose.moving && pose.grounded && !pose.swimming && !pose.sitting
        && !pose.lying && !pose.riding && !pose.dancing && distance > 1e-7);
      const ease = 1-Math.exp(-12*Math.max(0,dt));
      blend += ((active ? 1 : 0)-blend)*ease;
      run += ((pose.running ? 1 : 0)-run)*ease;
      // A sprint eases in over the run, a little slower, as a body leans into it.
      sprint += ((pose.running && pose.sprinting ? 1 : 0)-sprint)*(1-Math.exp(-6*Math.max(0,dt)));
      const m = (v) => mixOf(v, run, Math.min(sprint, run));
      const cycle = m(g.cycle);
      // Reject teleports or a scene-origin change. Neither is a footstep.
      if (active && distance < Math.max(.1, dt*4)) phase = (phase + distance/cycle) % 1;
      const stance = m(g.stance), span = cycle*stance*blend;
      // A walker is highest over the planted foot; a runner lowest there (the leg gives under
      // him) and highest in flight - so a runner's bob is turned half a step round, centred on
      // the middle of the stance.
      const step = g.runBounce ? (phase - stance/2)*TAU*2 : phase*TAU*2;
      const bob = g.runBounce
        ? g.bounce[0]*(1-run)*Math.cos(phase*TAU*2) + mixOf([0, g.bounce[1], g.bounce[2]], run, Math.min(sprint, run))*Math.cos(step)
        : m(g.bounce)*Math.cos(step);
      const drop = (m(g.drop) + bob)*blend;
      const lift0 = m(g.lift), kick = m(g.kick);
      const feet = [phase, (phase+.5)%1].map((p) => {
        const planted = p < stance;
        const u = planted ? p/stance : (p-stance)/(1-stance);
        const z = planted ? span*(.5-u) : span*(smooth(u)-.5);
        // The kick peaks a third of the way into the swing: the heel comes up behind first,
        // then the knee carries the foot through.
        const lift = planted ? 0 : (Math.sin(Math.PI*u)*lift0 + kick*Math.sin(Math.PI*Math.min(1, u*1.6))*(1-u))*blend;
        const angles = solveLeg(z, hipY-drop-ankleY-lift, upper, lower);
        // Return to a straight bind pose smoothly at rest.
        if (blend < 1e-4) return { hip:0, knee:0, ankle:0, z:0, lift:0, planted:true };
        return { ...angles, z, lift, planted };
      });
      return { phase: phase*TAU, blend, run, sprint: Math.min(sprint, run), drop, feet, active, span };
    },
  };
}
