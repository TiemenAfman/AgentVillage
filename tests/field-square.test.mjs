import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs',import.meta.url);
globalThis.document={createElementNS:()=>({addEventListener(){},removeEventListener(){},set src(_){}})};
const {planFields,TOWN,NONE}=await import('../web/js/hamlets.js');
delete globalThis.document;
const size=40;
const terrain={size,seed:1337,isLand:()=>true,isBeach:()=>false,slope:()=>0};
const village={island:{town:{paved:[[20,20],[21,20],[20,21],[21,21]]}}};
const all=(p)=>[...p.patches,...p.orchards,...p.gardens];
function clearOfSquare(plan){
 for(const p of all(plan))for(let z=p.gz;z<p.gz+p.d;z++)for(let x=p.gx;x<p.gx+p.w;x++)
  assert.ok(x<16||x>25||z<16||z>25,`field at ${x},${z} encroaches on the square verge`);
}
test('all field types leave the civic square and its full verge clear',()=>{
 for(const ownership of [NONE,0]) {
  const owner=new Int16Array(size*size).fill(ownership);
  const plan=planFields(village,terrain,owner,new Set(),{coverage:1});
  clearOfSquare(plan);
  assert.ok(all(plan).length>0,'farmland away from the square remains');
  assert.deepEqual(plan,planFields(village,terrain,owner,new Set(),{coverage:1}));
 }
});
test('town-owned gaps never become kitchen gardens, even beyond the paving',()=>{
 const owner=new Int16Array(size*size).fill(TOWN);
 assert.equal(all(planFields(village,terrain,owner,new Set(),{coverage:1})).length,0);
});
test('pre-surveyed fields cannot bypass the reservation and are not mutated',()=>{
 const near={gx:19,gz:19,w:2,d:2},far={gx:4,gz:4,w:2,d:2};
 const fields={patches:[near,far],orchards:[near,far],gardens:[near,far]};
 const owner=new Int16Array(size*size).fill(NONE);
 const result=planFields({...village,fields},terrain,owner,new Set());
 for(const type of ['patches','orchards','gardens'])assert.deepEqual(result[type],[far]);
 assert.equal(fields.gardens.length,2);
});
