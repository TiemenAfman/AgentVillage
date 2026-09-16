import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);
globalThis.document={createElementNS:()=>({addEventListener(){},removeEventListener(){},set src(_){}})};
const {buildBuilding,WALK_BODY_R}=await import('../web/js/buildings.js');
const models=await import('../web/js/models.js');
delete globalThis.document;
test('Blender dwellings fit the old body envelope and retain usable doors in every style',()=>{
 for(const kind of ['hut','cottage','house','manor','keep']) {
  const asset=`house_${kind}_a`;
  if(!models.hasAsset(asset))continue;
  for(const style of ['sonnet','opus','haiku','fable','unknown'])for(const modest of [true,false]) {
   const b=buildBuilding({id:'dwelling-preview',kind:'house',tier:kind,style,sheds:[]},{modest});
   assert.equal(b.geometry.groups.length,0);
   for(const attr of Object.values(b.geometry.attributes))assert.ok(attr.array.every(Number.isFinite));
   for(const r of b.solids)assert.ok(Math.abs(r.x)>r.hx+WALK_BODY_R || Math.abs(1.12-r.z)>r.hz+WALK_BODY_R,`${kind}/${style} blocks its door`);
   assert.ok(b.anchors.smoke[1]>0);
   b.geometry.dispose();
  }
 }
});
