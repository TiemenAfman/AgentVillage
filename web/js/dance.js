// The dance, the one copy of it (Plans/DONE/rave-in-het-kasteel.md, Plans/DONE/dansen.md): the moves the
// settlers on the castle's floor dance (settler-figures.js, off `f.anim = 'dance'`) and the ones a
// player dances when they press R (classic-avatar.js, for yourself in walk.js and for everybody
// else in peers.js). Two rigs, one set of angles, so a player on the floor dances the crowd's
// dance rather than a lookalike that drifts from it.
//
// Arms turn about x, as in both rigs: 0 hangs, -pi/2 points ahead, -2.8 is over the head.
// `u` is 0 on the kick, `down` is how far up between two kicks the knees have pushed (0 on the
// kick, which is where a crowd bends), and `alt` swings +1/-1 on alternate beats. Every number
// is an angle or a lift on a drawn matrix; none of it moves anybody.
import { RAVE_SONG } from './sound.js';
import { hash32, clamp } from 'shared/rng.mjs';

const { bpm: BPM, bars: BARS, build: BUILD } = RAVE_SONG;
const SPB = 60 / BPM;
const LOOP_BEATS = BARS * 4;

export const DANCE_MOVES = 6;          // pump, hands up, running man, wave, nod, and the DJ
export function dancePose(move, beat, hype = 0) {
  const u = beat - Math.floor(beat);
  const down = Math.sin(Math.PI * u);
  const pulse = Math.exp(-u * 6);
  const alt = Math.cos(Math.PI * beat);
  const slow = Math.sin(Math.PI * beat / 2);
  const jump = hype * 0.07 * down;
  const p = { bob: 0, left: 0, right: 0, legL: 0, legR: 0, roll: 0, twist: 0, lean: 0 };
  switch (move) {
    case 0:                 // the fist in the air on every kick
      p.bob = 0.03 * down + jump;
      p.right = -2.2 - 0.65 * pulse;
      p.left = -0.45 - 0.3 * down;
      p.legL = 0.12 * alt; p.legR = -0.12 * alt;
      p.roll = 0.03 * alt;
      break;
    case 1:                 // both hands up, swaying
      p.bob = 0.026 * down + jump;
      p.left = -2.85 + 0.14 * slow;
      p.right = -2.85 - 0.14 * slow;
      p.roll = 0.07 * slow;
      break;
    case 2:                 // the running man
      p.bob = 0.04 * down + jump;
      p.legL = 0.42 * alt; p.legR = -0.42 * alt;
      p.left = -1.0 + 0.45 * alt;
      p.right = -1.0 - 0.45 * alt;
      p.lean = 0.08;
      break;
    case 3:                 // one arm up and then the other, turning with it
      p.bob = 0.025 * down + jump;
      p.left = -1.2 - 1.5 * Math.max(0, slow);
      p.right = -1.2 - 1.5 * Math.max(0, -slow);
      p.twist = 0.28 * slow;
      p.roll = 0.04 * slow;
      break;
    case 4:                 // too cool to move much: a nod on the kick
      p.bob = 0.014 * down + jump * 0.5;
      p.lean = 0.12 * pulse;
      p.left = -0.25; p.right = -0.35 - 0.1 * down;
      p.twist = 0.08 * alt;
      break;
    default:                // the DJ: a hand on the decks, the other up when it drops
      p.bob = 0.02 * down;
      p.lean = 0.16 + 0.1 * pulse;
      p.right = -1.25 - 0.08 * down;
      p.left = hype > 0.3 ? -2.7 - 0.2 * pulse : -1.1 - 0.15 * alt;
      p.twist = 0.1 * slow;
  }
  return p;
}

// A player's dance: which move this bar and how hard the drop is hitting, from the dancer's own
// id and the beat, the way rave.js picks for a settler on the floor - two moves of their own,
// swapped every four bars, and everybody's hands up in the build's last bar. Nothing about it
// crosses the wire but the bit that says somebody is dancing (POSE.DANCING in net.js): every
// screen works the move out for itself off the same id, in the bar of the music *it* is
// playing, so a dancer keeps time with what whoever is watching hears. Never the DJ's move (5),
// which has its hand on the decks.
export function danceStep(id, beat) {
  const b = Math.max(0, beat);
  const inLoop = b - Math.floor(b / LOOP_BEATS) * LOOP_BEATS;
  const bar = Math.floor(inLoop / 4);
  const h = hash32(`${id}:dance`);
  const first = h % 5;
  const second = (first + 1 + ((h >>> 8) % 4)) % 5;           // never the same move twice
  const move = bar >= BUILD + 3 ? 1 : (Math.floor(bar / 4) % 2 ? second : first);
  const hype = bar < 2 ? clamp(1 - inLoop / 8, 0, 1) : 0;
  return { move, hype };
}

// The beat when there is no music to keep time to: the wall clock at the song's own tempo, so
// a dancer on the square and one in a hall with the sound off move at the same speed as the
// floor does with it on.
export function wallBeat(ms) {
  return ms / 1000 / SPB;
}

// The beat, from how far into the loop the music is (sound.raveClock, in seconds).
export function clockBeat(seconds) {
  return seconds / SPB;
}
