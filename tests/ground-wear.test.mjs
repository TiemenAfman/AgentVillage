import test from 'node:test';
import assert from 'node:assert/strict';
import { groundWearField } from '../web/js/ground-wear.js';
const sample=(f,x,z,size=16)=>f.data[Math.floor((x+size/2)*f.resolution/size)+Math.floor((z+size/2)*f.resolution/size)*f.resolution];
const lane={points:[[-4,0],[4,0]]};
test('sand has a solid walking centre, a graded verge and untouched meadow',()=>{
 const f=groundWearField(16,1337,[lane],[],256);
 for(let x=-3;x<=3;x+=.2)assert.ok(sample(f,x,0)>245);
 const fade=[.3,.4,.5,.6,.7].map(z=>sample(f,1,z));
 assert.ok(fade.some(n=>n>20 && n<230));
 assert.ok(new Set(fade).size>=4);
 assert.equal(sample(f,1,1.1),0);
});
test('junctions and yards unite without seams or overlap darkening',()=>{
 const cross={points:[[0,-4],[0,4]]};
 const yard={x:0,z:0,rx:1.15,rz:1.15};
 const a=groundWearField(16,7,[lane,cross],[yard],256);
 const b=groundWearField(16,7,[cross,lane,lane],[yard,yard],256);
 assert.deepEqual(a.data,b.data);
 assert.equal(sample(a,0,0),255);
 assert.ok(sample(a,.8,.8)>100);
 assert.equal(sample(a,1.6,1.6),0,'a yard has no square plot corners');
});
test('wear is deterministic, irregular, and disappears when a route is removed',()=>{
 const a=groundWearField(16,9,[lane],[],256);
 assert.deepEqual(a,groundWearField(16,9,[lane],[],256));
 assert.notDeepEqual(a.data,groundWearField(16,10,[lane],[],256).data);
 const edge=Array.from({length:30},(_,i)=>sample(a,-3+i*.2,.48));
 assert.ok(Math.max(...edge)-Math.min(...edge)>40);
 assert.ok(groundWearField(16,9,[],[],256).data.every(n=>n===0));
});
test('stamps crossing the map boundary remain finite and inside the buffer',()=>{
 const f=groundWearField(16,9,[{points:[[-12,0],[12,0]]}],[{x:8,z:8,rx:1,rz:1}],128);
 assert.equal(f.data.length,128*128);
 assert.ok(sample(f,7,0)>240);
});
