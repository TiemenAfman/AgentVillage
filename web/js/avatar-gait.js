// Distances are in island units. A planted foot travels backwards by exactly the
// distance the body advances; cadence follows distance, including partial input.
export const WALK_SPEED = .65;
export const RUN_SPEED = 1.10;
export const CROUCH_SPEED = .30;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (v) => v * v * (3 - 2 * v);

export function solveLeg(z, down, upper, lower) {
  const length = clamp(Math.hypot(z, down), Math.abs(upper-lower)+1e-6, (upper+lower)*.9999);
  const knee = Math.acos(clamp((length*length-upper*upper-lower*lower)/(2*upper*lower),-1,1));
  const hip = Math.atan2(-z, down) - Math.atan2(lower*Math.sin(knee), upper+lower*Math.cos(knee));
  return { hip, knee, ankle: -hip-knee };
}

export function createGait(hipY, kneeY, ankleY) {
  let phase = 0, blend = 0, run = 0;
  const upper = hipY-kneeY, lower = kneeY-ankleY;
  return {
    update(distance, pose, dt) {
      const active = !!(pose.moving && pose.grounded && !pose.swimming && !pose.sitting
        && !pose.lying && !pose.riding && !pose.dancing && distance > 1e-7);
      const ease = 1-Math.exp(-12*Math.max(0,dt));
      blend += ((active ? 1 : 0)-blend)*ease;
      run += ((pose.running ? 1 : 0)-run)*ease;
      const cycle = .29 + .09*run;
      // Reject teleports or a scene-origin change. Neither is a footstep.
      if (active && distance < Math.max(.1, dt*4)) phase = (phase + distance/cycle) % 1;
      const stance = .60-.14*run, span = cycle*stance*blend;
      const drop = (.030+.011*run + .0015*Math.cos(phase*TAU*2))*blend;
      const feet = [phase, (phase+.5)%1].map((p) => {
        const planted = p < stance;
        const u = planted ? p/stance : (p-stance)/(1-stance);
        const z = planted ? span*(.5-u) : span*(smooth(u)-.5);
        const lift = planted ? 0 : Math.sin(Math.PI*u)*(.026+.014*run)*blend;
        const angles = solveLeg(z, hipY-drop-ankleY-lift, upper, lower);
        // Return to a straight bind pose smoothly at rest.
        if (blend < 1e-4) return { hip:0, knee:0, ankle:0, z:0, lift:0, planted:true };
        return { ...angles, z, lift, planted };
      });
      return { phase: phase*TAU, blend, run, drop, feet, active };
    },
  };
}
