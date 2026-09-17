import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);
const {housePlacement}=await import('../web/js/house-placement.js');
const box={min:{x:-.75,z:-.7},max:{x:.75,z:.9}};
const spec={id:'house:fixture',kind:'house',plot:{gx:10,gz:10,w:3,d:3,rot:0}};
function bounds(b,p){
 const points=[];
 for(const x of [b.min.x,b.max.x])for(const z of [b.min.z,b.max.z])
  points.push([p.x+x*Math.cos(p.yaw)+z*Math.sin(p.yaw),p.z-x*Math.sin(p.yaw)+z*Math.cos(p.yaw)]);
 return {x0:Math.min(...points.map(v=>v[0])),x1:Math.max(...points.map(v=>v[0])),
  z0:Math.min(...points.map(v=>v[1])),z1:Math.max(...points.map(v=>v[1]))};
}
test('houses vary in angle and setback while every corner stays inside its land',()=>{
 const angles=new Set(),positions=new Set();
 for(let i=0;i<64;i++){
  const s={...spec,id:`house:${i}`,plot:{...spec.plot,rot:i%4}};
  const p=housePlacement(s,box), b=bounds(box,p);
  assert.deepEqual(p,housePlacement(s,box));
  assert.ok(b.x0>=-1.47&&b.x1<=1.47&&b.z0>=-1.47&&b.z1<=1.47);
  angles.add(p.yaw.toFixed(3));positions.add(`${p.x},${p.z}`);
 }
 assert.ok(angles.size>32);assert.ok(positions.size>20);
});
test('a neighbouring apprentice reserves space before the house is turned',()=>{
 const shed={id:'shed:fixture',master:spec.id,kind:'shed',plot:{gx:12,gz:11,w:1,d:1}};
 const b=bounds(box,housePlacement(spec,box,[shed]));
 assert.ok(b.x1<=1.21-.34||b.z1<=-.34||b.z0>=.34);
});
test('monuments, harbour and one-cell buildings retain their surveyed position',()=>{
 for(const s of [{...spec,kind:'civic',civicType:'fountain'},{...spec,harbour:true},{...spec,kind:'shed'},
  {...spec,plot:{...spec.plot,w:1,d:1}}])
  assert.deepEqual(housePlacement(s,box),{x:0,z:0,yaw:Math.PI});
});

test('real dwelling models and their yard props remain inside the reserved plot',async()=>{
 globalThis.document={createElementNS:()=>({addEventListener(){},removeEventListener(){},set src(_){}})};
 const {buildBuilding}=await import('../web/js/buildings.js');
 delete globalThis.document;
 let changed=0;
 for(const tier of ['tent','hut','cottage','house','manor','keep'])for(let i=0;i<8;i++){
  const s={...spec,id:`house:real-${tier}-${i}`,tier,style:'sonnet',sheds:[],plot:{...spec.plot,rot:i%4}};
  const built=buildBuilding(s),p=housePlacement(s,built.bbox),b=bounds(built.bbox,p);
  const base=Math.PI-(i%4)*Math.PI/2;
  if(p.x||p.z||Math.abs(p.yaw-base)>.001){
   changed++;
   assert.ok(b.x0>=-1.47&&b.x1<=1.47&&b.z0>=-1.47&&b.z1<=1.47,`${tier} crosses its boundary`);
  }
  built.geometry.dispose();
 }
 assert.ok(changed>=30,`only ${changed}/48 dwellings have room for varied placement`);
});

test('square buildings vary safely with their real geometry in all four orientations',async()=>{
 globalThis.document={createElementNS:()=>({addEventListener(){},removeEventListener(){},set src(_){}})};
 const {buildBuilding}=await import('../web/js/buildings.js');
 delete globalThis.document;
 const {SQUARE_BUILDINGS}=await import('../web/js/house-placement.js');
 for(const civicType of SQUARE_BUILDINGS){
  let varied=0;
  for(let rot=0;rot<4;rot++){
   const s={...spec,id:`civic:${civicType}`,kind:'civic',civicType,plot:{...spec.plot,rot}};
   const built=buildBuilding(s),p=housePlacement(s,built.bbox),b=bounds(built.bbox,p);
   assert.deepEqual(p,housePlacement(s,built.bbox));
   if(p.x||p.z||Math.abs(p.yaw-(Math.PI-rot*Math.PI/2))>.001){
    varied++;
    assert.ok(b.x0>=-1.47&&b.x1<=1.47&&b.z0>=-1.47&&b.z1<=1.47,`${civicType} crosses its lot`);
   }
   built.geometry.dispose();
  }
  assert.ok(varied>0,`${civicType} never varies`);
 }
});
