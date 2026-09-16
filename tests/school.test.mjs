import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const {buildBuilding,WALK_BODY_R}=await import('../web/js/buildings.js');
delete globalThis.document;
test('school faces its approach, fits its plot and keeps a clear front door',()=>{
 const b=buildBuilding({id:'c:school',kind:'civic',civicType:'school'});
 assert.ok(b.anchors.door[2]>.6);
 assert.ok(b.anchors.flag[0]>0);
 assert.equal(b.geometry.groups.length,0);
 assert.ok(b.geometry.attributes.position.count/3<4000);
 assert.ok(b.bbox.max.x<1.35 && b.bbox.min.x>-1.35);
 for(const r of b.solids) assert.ok(Math.abs(r.x)>r.hx+WALK_BODY_R || Math.abs(1.12-r.z)>r.hz+WALK_BODY_R);
 b.geometry.dispose();
});
