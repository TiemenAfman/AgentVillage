import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { Vector3 } from 'three';
import { TOWNHALL } from '../web/js/townhall-mesh.js';
import { TAVERN } from '../web/js/tavern-mesh.js';
register('./support/shared-loader.mjs', import.meta.url);
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { buildBuilding, WALK_BODY_R } = await import('../web/js/buildings.js');
delete globalThis.document;

test('town hall shares tavern materials and stays one mesh within its civic plot', () => {
  for (const [hall, inn] of [['Townhall lower plaster','Plaster walls'], ['Townhall terracotta roof','Main tiled roof'], ['Townhall upright','Oak upright']]) {
    assert.deepEqual(TOWNHALL.parts[hall].colors.slice(0,3), TAVERN.parts[inn].colors.slice(0,3));
    assert.equal(TOWNHALL.parts[hall].sheet,TAVERN.parts[inn].sheet);
  }
  const b=buildBuilding({id:'c:townhall',kind:'civic',civicType:'townhall',style:'unknown'},{keepParts:true});
  assert.equal(b.geometry.groups.length,0);
  assert.ok(b.geometry.attributes.position.count/3 < 4000);
  assert.ok(b.bbox.max.y <= b.height + 1e-5);
  assert.ok(b.bbox.max.x < 1.35 && b.bbox.min.x > -1.35 && b.bbox.max.z < 1.35);
  assert.ok(b.anchors.flag[1] > 2);
  assert.ok(Math.abs(b.anchors.smoke[1] - 2.32) < 1e-6, 'porch lifts the smoke with the chimney');
  assert.ok(b.anchors.door[2] > 0, 'entrance faces the square');
  for (const r of b.solids) assert.ok(Math.abs(r.x)>r.hx+WALK_BODY_R || Math.abs(1.12-r.z)>r.hz+WALK_BODY_R);
  for (const key of ['normal','color','aEmissive','aSheet']) {
    assert.equal(b.geometry.attributes[key].count,b.geometry.attributes.position.count);
    assert.ok(b.geometry.attributes[key].array.every(Number.isFinite));
  }
  assert.ok(b.geometry.attributes.aEmissive.array.includes(1));
  console.log(`Town hall: ${b.geometry.attributes.position.count/3} tris; baseline 818`);
  b.geometry.dispose();b.parts.forEach((g)=>g.dispose());
});

test('patina dome triangles face outward with ordinary front-face culling', () => {
  const part=TOWNHALL.parts['Townhall patina dome'];
  const a=new Vector3(),b=new Vector3(),c=new Vector3(),normal=new Vector3(),center=new Vector3();
  for(let i=0;i<part.positions.length;i+=9){
    a.fromArray(part.positions,i);b.fromArray(part.positions,i+3);c.fromArray(part.positions,i+6);
    center.copy(a).add(b).add(c).divideScalar(3).add(new Vector3(...part.at));
    normal.crossVectors(b.sub(a),c.sub(a));
    assert.ok(normal.dot(new Vector3(center.x,0,center.z+.13))>0);
  }
});
