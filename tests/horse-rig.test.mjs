import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';
register('./support/shared-loader.mjs', import.meta.url);
globalThis.document={createElementNS:()=>({addEventListener(){},removeEventListener(){},set src(_) {}})};
const {createMount,MOUNT_TOP,MOUNT_GALLOP}=await import('../web/js/mount.js');
const {FAUNA}=await import('../web/js/fauna-mesh.js');
delete globalThis.document;

test('the horse export has finite normalised skinning and closed outward surfaces',()=>{
  const edges=new Map();
  for(const name of FAUNA.assets.fauna_horse.parts) {
    const p=FAUNA.parts[name],count=p.positions.length/3;
    assert.equal(p.normals.length,p.positions.length);
    assert.equal(p.skinIndices.length,count*4);
    for(let i=0;i<count;i++) {
      const sum=p.skinWeights.slice(i*4,i*4+4).reduce((a,b)=>a+b,0);
      assert.ok(Math.abs(sum-1)<.00001);
      assert.ok(p.skinIndices.slice(i*4,i*4+4).every(n=>n>=0&&n<17));
    }
    // Per material edges can border another material. Count across the whole object.
    const object=name.split(':')[0];
    for(let i=0;i<p.positions.length;i+=9) {
      const points=[0,3,6].map(k=>p.positions.slice(i+k,i+k+3).map((v,j)=>Math.round((v+p.at[j])*1e6)).join(','));
      for(let k=0;k<3;k++) {
        const a=points[k],b=points[(k+1)%3],key=object+':'+[a,b].sort().join('|');
        edges.set(key,(edges.get(key)||0)+(a<b?1:-1));
      }
    }
  }
  assert.equal([...edges.values()].filter(n=>n!==0).length,0,'unpaired or inward-facing edges');
});

test('loaded hooves stay level, on the floor and planted in world space in both gaits',()=>{
  const mat=new THREE.MeshBasicMaterial();
  const mount=createMount({scene:new THREE.Scene(),material:mat});
  const dt=1/240;
  for(const speed of [MOUNT_TOP,MOUNT_TOP*MOUNT_GALLOP,-.22]) for(const yaw of [0,.7]) {
    let z=0,last=new Map(),contacts=0,maxFloor=0,maxSlide=0,maxLift=0;
    for(let frame=0;frame<1100;frame++) {
      z+=speed*dt;mount.place(Math.sin(yaw)*z,0,Math.cos(yaw)*z,yaw);mount.pose({speed,rate:yaw?.5:0},dt);
      const now=new Map();
      mount.joints.legs.forEach((leg,i)=>{
        const sole=new THREE.Vector3(0,-leg.sole,0);
        leg.hoof.localToWorld(sole);
        const contact=mount.ride.pose.hooves[i].contact;
        if(frame>240&&contact){
          contacts++;
          maxFloor=Math.max(maxFloor,Math.abs(sole.y));
          if(last.has(i))maxSlide=Math.max(maxSlide,sole.distanceTo(last.get(i)));
        }
        if(contact)now.set(i,sole);
        maxLift=Math.max(maxLift,sole.y);
      });
      last=now;
    }
    assert.ok(contacts>100);
    assert.ok(maxLift>.025,'feet never lift');
    assert.ok(maxFloor<.001,`speed ${speed}: sole ${maxFloor} off floor`);
    assert.ok(maxSlide<.0002,`speed ${speed}: planted hoof moves ${maxSlide} per frame`);
  }
  mount.dispose();mat.dispose();
});
