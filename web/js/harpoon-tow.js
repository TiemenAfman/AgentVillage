// A hull on a harpoon's line (Plans/harpoen.md): what a taut line does to the ship it is fired from -
// to land (she is drawn to it, and making way she swings round it) or to another ship ("chase": hers
// moves, ours hangs on). Only ever to our own hull and only while this page is the one stepping her
// (main.js asks: not followed), because on the sea a boat is moved by whoever holds her helm or has
// just let go of it (lib/boats.mjs); somebody else's boat is never moved by this page.
//
// A hull here makes way only along her heading (`b.v`, stepBoat), so a line cannot simply add a
// velocity. It does what a tow does to a ship: she cannot get further from the hook than the line is
// long (put back onto that circle, eased over TOW_EASE so it is not a jump), what of her way points
// away from the hook is taken off, her bow is swung towards the pull, and while the reel takes line in
// she gathers way towards it - up to TOW_SPEED. Page-only and frame-stepped; nothing here goes to the
// sea, which sees the hull where her pilot's page sends her, as always.

export const TOW_EASE = 0.25;      // s: how fast the stretch past the line's length is taken out
export const TOW_TURN = 0.5;       // rad/s her bow swings towards the pull, at most
export const TOW_SPEED = 3.5;      // u/s she is drawn at - under the reel's 4, so the line stays taut
export const TOW_ACCEL = 1.2;      // u/s^2 she gathers that way at
export const TOW_BRAKE = 1.5;      // 1/s: her way taken off at the end of the line

const wrap = (a) => a - Math.round(a / (Math.PI * 2)) * Math.PI * 2;

// One frame: `b` the hull ({ x, z, yaw, v }, mutated), `at` the hook ({ x, z }), `L` the line's length,
// `reeling` whether the reel is still taking line in (false once it is all in, which is when she is
// braked). Answers whether the line was taut.
export function towHull(b, at, L, dt, reeling = true) {
  const dx = at.x - b.x, dz = at.z - b.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return false;
  // Drawn all the way in (the reel has stopped), heading for the hook: the crew takes her way off, or
  // a line to a rock would end with her on it.
  if (!reeling && b.v > 0 && d < L * 1.5 && (Math.sin(b.yaw) * dx + Math.cos(b.yaw) * dz) / d > 0.7) {
    b.v -= b.v * Math.min(1, TOW_BRAKE * dt);
  }
  if (d <= L) return false;
  const nx = dx / d, nz = dz / d;
  const k = Math.min(1, dt / TOW_EASE);
  b.x += nx * (d - L) * k;
  b.z += nz * (d - L) * k;
  const hx = Math.sin(b.yaw), hz = Math.cos(b.yaw);
  const along = hx * nx + hz * nz;
  // Way away from the hook is taken off; way across it is left, which is the swing round it.
  const out = b.v * along;
  if (out < 0) b.v -= out * along;
  // Her bow towards the pull: the shorter way round.
  const turn = wrap(Math.atan2(nx, nz) - b.yaw);
  const step = TOW_TURN * dt;
  b.yaw = wrap(b.yaw + (turn > step ? step : turn < -step ? -step : turn));
  if (reeling && along > 0.3 && b.v < TOW_SPEED) b.v = Math.min(TOW_SPEED, b.v + TOW_ACCEL * dt);
  return true;
}
