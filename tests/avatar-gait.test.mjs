import test from 'node:test';
import assert from 'node:assert/strict';
import { createGait, solveLeg, WALK_SPEED, RUN_SPEED } from '../web/js/avatar-gait.js';
const pose={moving:true,grounded:true,running:false};
const make=()=>createGait(.179*1.12,.104*1.12,.037*1.12);

test('cadence follows distance at both frame rates and partial stick input',()=>{
  const sample=(hz,speed)=>{const gait=make();let out;for(let i=0;i<hz;i++)out=gait.update(speed/hz,pose,1/hz);return out;};
  const a=sample(30,WALK_SPEED),b=sample(120,WALK_SPEED),slow=sample(60,WALK_SPEED/2);
  assert.ok(Math.abs(a.phase-b.phase)<1e-10);
  assert.ok(Math.abs(slow.phase-((WALK_SPEED/2/.29)%1)*Math.PI*2)<1e-10);
  assert.ok(RUN_SPEED>WALK_SPEED && RUN_SPEED<2*WALK_SPEED);
});

test('standing against a wall never advances the step cycle',()=>{
  const gait=make();let out=gait.update(.03,pose,.05);const phase=out.phase;
  for(let i=0;i<180;i++)out=gait.update(0,pose,1/60);
  assert.equal(out.phase,phase);assert.ok(out.blend<1e-8);
  assert.deepEqual(out.feet.map(f=>f.knee),[0,0]);
});

test('planted feet stay at the same world position and lifted feet clear the floor',()=>{
  for(const running of [false,true]){
    const gait=make(),p={...pose,running};const dt=1/120,speed=running?RUN_SPEED:WALK_SPEED;
    let distance=0,previous=null,checks=0;
    for(let i=0;i<600;i++){
      distance+=speed*dt;const out=gait.update(speed*dt,p,dt);
      if(i>300 && previous)for(let j=0;j<2;j++){
        const f=out.feet[j],before=previous.out.feet[j];
        if(f.planted && before.planted && f.z<before.z){
          assert.ok(Math.abs((distance+f.z)-(previous.distance+before.z))<1e-7);
          assert.equal(f.lift,0);checks++;
        }
        assert.ok(f.lift>=0);
      }
      previous={distance,out};
    }
    assert.ok(checks>100);
  }
});

test('two-bone leg reaches the foot target while keeping the sole level',()=>{
  const upper=.075*1.12,lower=.067*1.12;
  for(const z of [-.08,-.03,0,.04,.08]){
    const down=.13,leg=solveLeg(z,down,upper,lower);
    const gotZ=-upper*Math.sin(leg.hip)-lower*Math.sin(leg.hip+leg.knee);
    const gotDown=upper*Math.cos(leg.hip)+lower*Math.cos(leg.hip+leg.knee);
    assert.ok(Math.abs(gotZ-z)<1e-9);assert.ok(Math.abs(gotDown-down)<1e-9);
    assert.ok(Math.abs(leg.hip+leg.knee+leg.ankle)<1e-9);
  }
});

 test('running has a short flight phase and smoothly returns to walking',()=>{
 const gait=make();let flight=0,out;
 for(let i=0;i<600;i++){out=gait.update(RUN_SPEED/120,{...pose,running:true},1/120);if(i>300&&out.feet.every(f=>!f.planted))flight++;}
 assert.ok(flight>10);
 const before=out.run;out=gait.update(WALK_SPEED/120,pose,1/120);assert.ok(out.run>0&&out.run<before);
 for(let i=0;i<600;i++){out=gait.update(WALK_SPEED/120,pose,1/120);if(i>300)assert.ok(out.feet.some(f=>f.planted));}
 });
