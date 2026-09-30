// The exclamation mark over the pirate's head while he has business with you
// (shared/quests.mjs `pirateHasBusiness`): a quest to start or to hand in.
//
// A sprite in this page's scene and nothing on the wire, which is what makes it yours alone:
// another player, on the same island at the same moment, is at a different step of the story
// and sees a different pirate. It bobs, and it grows with the camera's distance so it can
// still be read from the sky, where a settler is a few pixels tall.
import * as THREE from 'three';

// How high over a settler's feet, in island units. The hover label sits at 0.62 and a settler
// is a little over half a unit tall, so this floats clear of both.
export const MARK_LIFT = 1.05;

// Its size for a camera `dist` units away: a hand's width up close, growing with distance so the
// angle it covers stays readable, and capped so it is not a sign from the sky.
export function markScale(dist) {
  const d = Math.max(0, dist);
  return Math.min(2.4, 0.3 + d * 0.011);
}

function paint() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '900 108px Georgia, serif';
  g.lineJoin = 'round';
  g.lineWidth = 14;
  g.strokeStyle = 'rgba(38,24,8,.95)';
  g.strokeText('!', 64, 68);
  g.fillStyle = '#ffd24a';
  g.fillText('!', 64, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createQuestMark() {
  const map = paint();
  const mat = new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.visible = false;
  sprite.renderOrder = 4;
  sprite.name = 'quest-mark';
  return {
    sprite,
    // At a figure standing at (x, z) with feet at y, seen from `camera`, at `seconds` for the bob.
    place(x, y, z, camera, seconds) {
      const dist = camera.position.distanceTo(sprite.position.set(x, y + MARK_LIFT + Math.sin(seconds * 3) * 0.06, z));
      const s = markScale(dist);
      sprite.scale.set(s, s, 1);
      sprite.visible = true;
    },
    hide() { sprite.visible = false; },
    dispose() {
      if (sprite.parent) sprite.parent.remove(sprite);
      map.dispose();
      mat.dispose();
    },
  };
}
