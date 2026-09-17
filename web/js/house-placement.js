import { hash32, makeRng } from 'shared/rng.mjs';

// Large civic lots can loosen their frontage just like residential lots.
// One-cell monuments and signs retain their surveyed position and clearances.
export const SQUARE_BUILDINGS = new Set(['townhall', 'market', 'tavern', 'school', 'chapel', 'clocktower', 'watertower']);

// The survey keeps land and lanes stable. Within that land, houses follow a
// looser building line. Fit the complete model (porch and yard props included)
// rather than assuming every tier has the same footprint.
export function housePlacement(spec, bbox, neighbours = []) {
  const base = Math.PI - (spec.plot?.rot || 0) * Math.PI / 2;
  const unchanged = { x: 0, z: 0, yaw: base };
  const p = spec.plot;
  const civic = spec.kind === 'civic' && SQUARE_BUILDINGS.has(spec.civicType);
  if (!p || p.w !== 3 || p.d !== 3 || (spec.kind !== 'house' && !civic) || spec.harbour) return unchanged;
  const rng = makeRng(hash32(`${spec.id}:placement`));
  const target = { x: (rng.next()-.5)*.86, z: (rng.next()-.5)*.86,
    yaw: base + (rng.next() < .5 ? -1 : 1) * (.15 + rng.next()*.28) };
  // Apprentices occupy the outer part of their cell (main.js's yardNudge).
  // Reserve the entire shed envelope, including its porch, before trying a pose.
  const obstacles = neighbours.filter(b => b.kind === 'shed' && b.plot).map(b => {
    const dx = b.plot.gx-(p.gx+1), dz = b.plot.gz-(p.gz+1);
    return { x: dx + (b.master === spec.id && Math.abs(dx)<=1 && Math.abs(dz)<=1 ? Math.sign(dx)*.21 : 0),
      z: dz + (b.master === spec.id && Math.abs(dx)<=1 && Math.abs(dz)<=1 ? Math.sign(dz)*.21 : 0) };
  }).filter(o => Math.abs(o.x)<3 && Math.abs(o.z)<3);
  let best = unchanged, score = Infinity;
  for (let a=0;a<=12;a++) {
    const yaw = base + (target.yaw-base)*a/12;
    const c=Math.cos(yaw), s=Math.sin(yaw);
    const corners=[];
    for(const x of [bbox.min.x,bbox.max.x])for(const z of [bbox.min.z,bbox.max.z])
      corners.push([x*c+z*s,-x*s+z*c]);
    const loX=Math.min(...corners.map(v=>v[0])), hiX=Math.max(...corners.map(v=>v[0]));
    const loZ=Math.min(...corners.map(v=>v[1])), hiZ=Math.max(...corners.map(v=>v[1]));
    for(let ix=-6;ix<=6;ix++)for(let iz=-6;iz<=6;iz++) {
      const x=ix*.07,z=iz*.07;
      if(loX+x < -1.47 || hiX+x > 1.47 || loZ+z < -1.47 || hiZ+z > 1.47)continue;
      if(obstacles.some(o=>hiX+x>o.x-.34 && loX+x<o.x+.34 && hiZ+z>o.z-.34 && loZ+z<o.z+.34))continue;
      const cost=(x-target.x)**2+(z-target.z)**2+3*(yaw-target.yaw)**2;
      if(cost<score){score=cost;best={x,z,yaw};}
    }
  }
  return best;
}
