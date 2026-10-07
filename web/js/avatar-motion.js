import * as THREE from 'three';
import { normalizeAvatar, loadAvatar, CHARACTERS } from './avatar.js';
import { createClassicAvatar, DROWN_SINK, DEATH_REST, CLIMB_SPEED, horsebackOf } from './classic-avatar.js';
import { createAvatarStudio } from './studio.js';
import { swimPose, TREAD_SINK } from './diving.js';
import { loadSet } from './models.js';
import { meshAsset, createBuildingMaterial } from './buildings.js';
import { createMount, MOUNT_TOP, MOUNT_GALLOP } from './mount.js';
import { KIT, MAST_LADDER, MAST_FROM } from './kraken-layout.js';
import { RUNG_STEP, RUNG_R, RUNG_OUT } from 'shared/deck.mjs';
import { CRAFTS } from 'shared/crafts.mjs';
import { DECK_Y } from 'shared/hull.mjs';
import { createBoat } from './boat.js';

const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('#motion'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x94aa9a);
const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0x94aa9a, 4, 10);
scene.add(new THREE.HemisphereLight(0xfff3da, 0x617963, 2.2));
const sun = new THREE.DirectionalLight(0xfff4e0, 3); sun.position.set(-2, 4, 3); sun.castShadow = true;
sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-2;sun.shadow.camera.right=2;sun.shadow.camera.top=2;sun.shadow.camera.bottom=-2;sun.shadow.normalBias=.002;scene.add(sun);
const mat = new THREE.MeshStandardMaterial({ vertexColors:true, roughness:.85 });
// Both bodies side by side (Plans/tweede-avonturier.md), each in the look saved for it here,
// on one carrier so they share the stride, the track and the camera.
const saved = loadAvatar();
const carrier = new THREE.Group();scene.add(carrier);
const figures = CHARACTERS.map((c, i) => {
  const look = normalizeAvatar({ ...saved, character: c.id });
  const rig = createClassicAvatar(look, mat);
  const stand = new THREE.Group();stand.position.x = (i - (CHARACTERS.length - 1) / 2) * .34;
  stand.add(rig.object);carrier.add(stand);
  return { id: c.id, rig, stand, x: stand.position.x, distance: 0 };
});
// On horseback (web/js/mount.js, Plans/paard-in-plaats-van-fiets.md): the Adventurer on the horse F
// gives him on the island - the keeper's decision is that he is its only rider, so the Traveller
// steps out of the picture meanwhile. Seated as walk.js seats him: the horse placed and posed
// first, then the outer group (here `stand`, there `avatar`) on its saddle through its matrix and
// turned with it, the rig told `horseback`. Paard toggles stand/trot; Sprint or Shift selects gallop.
const HORSE_GAITS=[['stilstaan',0],['draf',MOUNT_TOP],['galop',MOUNT_TOP*MOUNT_GALLOP]];
// Use the island material, including the horse's exported smooth skin normals.
const horseMat=createBuildingMaterial();
let horse=null, horseGait=1, horseHelper=null;
const rider=figures.find(f=>f.id==='adventurer');
const seatAt=new THREE.Vector3();
const traveller = figures[0].rig;
const floor = new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({ color:0x758968, roughness:1 }));floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;scene.add(floor);
const track=new THREE.Group();scene.add(track);
for(let i=-60;i<=60;i++){
  const stripe=new THREE.Mesh(new THREE.BoxGeometry(.65,.002,.014),new THREE.MeshStandardMaterial({color:i%5===0?0xe1d5b3:0xadc09d,roughness:1}));
  stripe.position.set(0,.001,i*.2);track.add(stripe);
}
const helper=new THREE.SkeletonHelper(carrier);helper.visible=false;scene.add(helper);
const camera=new THREE.PerspectiveCamera(32,1,.01,100);
// walk.js's own numbers, for the Springen button.
const JUMP_V=3.1, GRAVITY=12.5, SWIM_SPEED=1.9;
// Up a rope ladder (Klimmen): at walk.js's CLIMB_SPEED, up from the floor to CLIMB_TOP and from the
// bottom again, down the same way, or hanging still (`climbDir` 1, -1, 0: the stick's push in
// walk.js); each body facing its own ladder, its feet CLIMB_OUT in front of the ropes
// (shared/deck.mjs) and the rungs the climb's own (RUNG_STEP apart from the floor, rung 0, and
// RUNG_OUT in front of the ropes - as boat.js and the Salty Kraken's bake hang them), seen from
// behind as on foot. The rig is handed what walk.js hands it on the rungs, `climbing: { rise, at }`,
// so this is the climb the island draws - Dichtbij looks at one body at a time. CLIMB_TOP is a
// whole number of cycles (two rungs each), so going round it is no jump in the pose.
const CLIMB_TOP=20*RUNG_STEP, CLIMB_OUT=.16, ROPE_HW=.14;
let climbDir=1, climbY=0;
const ropeMat=new THREE.MeshStandardMaterial({color:0x9c7f52,roughness:1});
const ladders=figures.map(f=>{
  const g=new THREE.Group(), rungs=[];
  for(const x of [-ROPE_HW,ROPE_HW]){const r=new THREE.Mesh(new THREE.BoxGeometry(.012,CLIMB_TOP+.6,.012),ropeMat);r.position.set(x,(CLIMB_TOP+.6)/2,RUNG_OUT);g.add(r);}
  // each rung its own material, so the one a hand or foot has hold of can light up (Houvast)
  for(let k=1;k*RUNG_STEP<CLIMB_TOP+.55;k++){const r=new THREE.Mesh(new THREE.BoxGeometry(2*ROPE_HW+.012,2*RUNG_R,2*RUNG_R),new THREE.MeshStandardMaterial({color:0x6e4d2b,roughness:1}));r.position.set(0,k*RUNG_STEP,RUNG_OUT);g.add(r);rungs.push(r);}
  g.visible=false;g.position.x=f.stand.position.x;scene.add(g);return Object.assign(g,{rungs});
});
// Houvast: where the hands and feet are, a dot on each - grey while it moves, lit while it holds
// (it stands still on the ladder while the body rises: under 0.3 of the climb's speed), hands
// orange and feet blue, and the rung under it lit in the same colour. A hand's rung is the one the
// foot on that side stands on a cycle later; the dots say whether they really meet.
const HOLD_COLOURS={hand:0xff9a3c,foot:0x46b4ff}, IDLE=0x5d665f;
const LIMBS=[['leftArm','hand'],['rightArm','hand'],['leftLeg','foot'],['rightLeg','foot']];
let showHolds=true;
const holdDots=figures.map(()=>LIMBS.map(([,kind])=>{
  const m=new THREE.Mesh(new THREE.SphereGeometry(.011,12,8),new THREE.MeshBasicMaterial({color:IDLE,depthTest:false}));
  m.renderOrder=5;m.visible=false;scene.add(m);return {m,kind,was:null,held:false};
}));
const limbAt=new THREE.Vector3();
function limbPoint(rig,limb,out){
  const o=limb.endsWith('Arm')?rig.handAttach[limb]:rig.joints[limb].toe;
  return o.getWorldPosition(out);
}
function showHoldsFor(i,f,rising){
  const dots=holdDots[i], lad=ladders[i], on=showHolds&&mode==='climb'&&f.stand.visible;
  for(const r of lad.rungs)r.material.color.setHex(0x6e4d2b);
  for(const [j,[limb]] of LIMBS.entries()){
    const d=dots[j];d.m.visible=on;
    if(!on){d.was=null;continue;}
    limbPoint(f.rig,limb,limbAt);
    // the limb's height on the ladder, against the body's own rise this step
    const y=limbAt.y-lad.position.y;
    d.held=d.was!==null&&Math.abs(rising)>1e-5&&Math.abs((y-d.was)/rising)<.3||(d.held&&Math.abs(rising)<=1e-5);
    d.was=y;d.m.position.copy(limbAt);
    d.m.material.color.setHex(d.held?HOLD_COLOURS[d.kind]:IDLE);
    if(d.held){
      // a hand closes round a rung's middle, a foot's ball stands on its top
      const k=Math.round((y-(d.kind==='foot'?RUNG_R:0))/RUNG_STEP);
      d.rung=k;d.off=y-(d.kind==='foot'?RUNG_R:0)-k*RUNG_STEP;
      if(lad.rungs[k-1])lad.rungs[k-1].material.color.setHex(HOLD_COLOURS[d.kind]);
    }
  }
}
// Or up the Salty Kraken's mast (Mastladder): the hall's own kit piece (krakenkit, a lazy set), its
// ladder's rungs MAST_LADDER out from the mast and the body MAST_FROM before them, where the room's walk mode climbs it
// (kraken-layout.js MAST_CLIMBS) - to see the climb against the rungs it is really done on, which
// are cut to the climb as a rope ladder's are (Houvast lights where hands and feet hold). One mast, so one body: Dichtbij picks which.
let onMast=false, mast=null;
const MAST_TOP=Math.floor((KIT.mast.nest-.2)/(2*RUNG_STEP))*2*RUNG_STEP;
function showMast(){
  if(mast)return;
  mast=new THREE.Group();mast.visible=false;scene.add(mast);
  loadSet('krakenkit').then(()=>{
    // turned so the kit's +x, where the ladder leans out, points at the climber (+z here)
    // its own material, flat: the bodies' is patched for their skins, and a bake's part may carry
    // no normals (the building material shades it flat too)
    const wood=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.9,flatShading:true});
    for(const g of meshAsset('civic_kraken_mast',0xffffff,{ry:-Math.PI/2})){const m=new THREE.Mesh(g,wood);m.castShadow=m.receiveShadow=true;mast.add(m);}
  },e=>console.warn('[motion] no mast:',e.message));
}
// Or up the galleon's mainmast to her crow's nest (Kraaiennest, Plans/DONE/kraaiennest.md): her own hull,
// the ladder welded into it by boat.js (craft.aloft), turned so the climber faces the mast as the
// others face theirs - her `out` onto +z - and lowered so the ladder's foot, rung 0, is this floor.
// Eight units of rope: the camera rises with the climber, and over the top it starts again.
let onNest=false, nest=null;
const ALOFT=CRAFTS.galleon.aloft[0];
const NEST_TOP=Math.floor((ALOFT.top-ALOFT.foot-.1)/(2*RUNG_STEP))*2*RUNG_STEP;
function showNest(){
  if(nest)return;
  nest=createBoat({scene,material:new THREE.MeshStandardMaterial({vertexColors:true,roughness:.9,flatShading:true}),kind:'ship'}).object;
  nest.visible=false;nest.receiveShadow=true;
  // out (ox, oz) onto +z: a turn of yaw sends (x, z) to (x cos + z sin, -x sin + z cos)
  nest.rotation.y=Math.atan2(-ALOFT.out[0],ALOFT.out[1]);
}
let jumpAt=null, deathAt=0;
for(const button of document.querySelectorAll('[data-climb]'))button.onclick=()=>{
  climbDir=Number(button.dataset.climb);
  for(const b of document.querySelectorAll('[data-climb]'))b.setAttribute('aria-pressed',String(b===button));
};
for(const button of document.querySelectorAll('[data-ladder]'))button.onclick=()=>{
  onMast=button.dataset.ladder==='mast';onNest=button.dataset.ladder==='nest';climbY=0;
  if(onMast)showMast();
  if(onNest)showNest();
  for(const b of document.querySelectorAll('[data-ladder]'))b.setAttribute('aria-pressed',String(b===button));
};
let mode='walk', side=false, distance=0, last=performance.now(), time=0, bob=0;
// The inventory dresses whichever body it has chosen; the other keeps what it had on.
const inventory=createAvatarStudio(document.body,{onApply:spec=>{for(const f of figures)if(f.id===spec.character)f.rig.set(spec);}});
document.querySelector('#motion-inventory').onclick=()=>inventory.open();
document.querySelector('#motion-holds').onchange=e=>{showHolds=e.target.checked;};
document.querySelector('#motion-bones').onchange=e=>{helper.visible=e.target.checked;if(horseHelper)horseHelper.visible=e.target.checked;};
// Close up on one body at a time, to judge how a hat or a strap sits: off, then each in turn.
let close=-1;
document.querySelector('#motion-close').onclick=e=>{close=close+1<figures.length?close+1:-1;e.target.textContent=close<0?'Dichtbij':CHARACTERS[close].name;};
document.querySelector('#motion-jump').onclick=()=>{if(jumpAt===null)jumpAt=time;};
document.querySelector('#motion-view').onclick=e=>{side=!side;e.target.textContent=side?'Driekwartaanzicht':'Zijaanzicht';};
const horseNote=()=>{const[name,speed]=HORSE_GAITS[horseGait];return`Paard · ${name}${speed?` op ${speed.toFixed(1)} per seconde`:''} · alleen de Avonturier rijdt (F); Sprint of Shift is galop; Paard wisselt draf en stilstaan`;};
for(const button of document.querySelectorAll('[data-gait]'))button.onclick=()=>{
  if(button.dataset.gait==='sprint'&&mode==='horse') {
    horseGait=horseGait===2?1:2;
    document.querySelector('#motion-note').textContent=horseNote();
    syncHorseControls();
    return;
  }
  if(button.dataset.gait==='horse'&&mode==='horse')horseGait=horseGait===0?1:0;
  if(button.dataset.gait==='horse')button.textContent=`Paard · ${HORSE_GAITS[horseGait][0]}`;
  mode=button.dataset.gait;
  deathAt=time;
  for(const b of document.querySelectorAll('[data-gait]'))b.setAttribute('aria-pressed',String(b===button));
  document.querySelector('#motion-note').textContent=mode==='horse'?horseNote():mode==='idle'?'Stilstaan · ontspannen houding':mode==='run'?'Rennen · de draf als de stamina op is':mode==='sprint'?'Sprinten · Shift met stamina: voorover, lange passen, armen pompen':mode==='swim'?'Zwemmen · schoolslag, gekanteld zoals walk.js een zwemmer kantelt':mode==='tread'?'Watertrappen · stil in het water, rechtop':mode==='dig'?'Graven · met de schep':mode==='climb'?'Klimmen · een touwladder op: elke hand en voet pakt om de andere sport, en staat stil op die sport terwijl het lijf stijgt':mode==='fall'?'Vallen · leeg geslagen: door de knieën en voorover, steeds opnieuw':mode==='drown'?'Verdrinken · zonder lucht: rechtop, armen naar boven, zinkend':'Lopen · voeten landen, dragen het gewicht en rollen af';
};
const syncHorseControls=()=>{
  document.querySelector('[data-gait="horse"]').textContent='Paard · '+HORSE_GAITS[horseGait][0];
  document.querySelector('[data-gait="sprint"]').setAttribute('aria-pressed',String(horseGait===2));
  document.querySelector('#motion-note').textContent=horseNote();
};
addEventListener('keydown',e=>{if(e.key==='Shift'&&mode==='horse'&&!e.repeat){horseGait=2;syncHorseControls();}});
addEventListener('keyup',e=>{if(e.key==='Shift'&&mode==='horse'){horseGait=1;syncHorseControls();}});
addEventListener('blur',()=>{if(mode==='horse'&&horseGait===2){horseGait=1;syncHorseControls();}});
function resize(){renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();}
addEventListener('resize',resize);resize();
function frame(now){
  const dt=Math.min(.05,(now-last)/1000);last=now;
  if(!window.travellerPreview?.held)tick(dt);render();requestAnimationFrame(frame);
}
// One step of everything that moves, apart from drawing it - so a check can step it at a steady
// rate (travellerPreview.advance) where a hidden browser pane would run no frames at all.
function tick(dt){
  time+=dt;
  const masted=mode==='climb'&&(onMast||onNest), climber=close<0?0:close;
  // Climbing close up (Dichtbij) shows the one body and its ladder alone: from the side the other
  // stands in front of it.
  for(const [i,l] of ladders.entries())l.visible=mode==='climb'&&!onMast&&!onNest&&(close<0||i===climber);
  if(mode!=='climb')for(const dots of holdDots)for(const d of dots){d.m.visible=false;d.was=null;}
  if(mast)mast.visible=masted&&onMast;
  if(nest)nest.visible=masted&&onNest;
  for(const [i,f] of figures.entries())f.stand.visible=mode==='climb'&&(masted||close>=0)?i===climber:true;
  document.querySelector('#motion-climb').hidden=mode!=='climb';
  // Round the ladder: past the top back to the foot and the other way, a jump that is no climb.
  const climbWas=climbY, top=onMast?MAST_TOP:onNest?NEST_TOP:CLIMB_TOP;
  if(mode==='climb'){climbY+=climbDir*CLIMB_SPEED*dt;if(climbY>top)climbY-=top;if(climbY<0)climbY+=top;}
  const climbRise=Math.abs(climbY-climbWas)<.5?climbY-climbWas:0;
  // `climbY` going round the top is a jump; the dots forget where they were
  if(climbRise===0&&climbY!==climbWas)for(const dots of holdDots)for(const d of dots)d.was=null;
  // walk.js's swimming beat: quick in the stroke, slow treading water.
  bob+=dt*(mode==='swim'?6.5:1.4);
  const riding=mode==='horse'&&!!(horse||(horse=createMount({scene,material:horseMat,seed:'motion:horse'})));
  if(horse)horse.visible=riding;
  if(horse&&!horseHelper){horseHelper=new THREE.SkeletonHelper(horse.object);horseHelper.visible=document.querySelector('#motion-bones').checked;scene.add(horseHelper);}
  if(horseHelper)horseHelper.visible=riding&&document.querySelector('#motion-bones').checked;
  // Each body at its own speed (avatar-gait.js GAITS), so they draw apart: the camera follows
  // the one looked at closely, else the two's middle.
  for(const f of figures){
    const speed=mode==='sprint'?f.rig.speeds.sprint:mode==='run'?f.rig.speeds.run:mode==='walk'?f.rig.speeds.walk:mode==='swim'?SWIM_SPEED:0;
    // A dig is switched on and off with the button, as walk.js does with E at a mark.
    if((mode==='dig')!==!!f.rig.digging())f.rig.dig(mode==='dig');
    if(riding)f.stand.visible=f===rider;
    if(riding){
      if(f!==rider)continue;
      const speed=HORSE_GAITS[horseGait][1];
      f.distance+=speed*dt;
      horse.place(0,0,f.distance,0);
      horse.pose({speed},dt);
      horse.seat(seatAt,f.rig.hipY,horsebackOf(f.id).perch);
      f.stand.position.copy(seatAt);
      f.stand.quaternion.copy(horse.object.quaternion);
      f.rig.update({moving:false,grounded:true,horseback:true,distance:0},dt);
      continue;
    }
    f.stand.position.x=f.x;
    // In the water each body lies as walk.js lays it (diving.js swimPose): forward in the stroke,
    // upright treading water, and the Traveller rolling and nodding on walk.js's beat - a body
    // that swims its own stroke (`strokes`) only leans, as on the island.
    const wet=mode==='swim'||mode==='tread', lie=mode==='swim'?1:0, pose=swimPose(lie,f.rig.strokes?0:bob);
    f.stand.rotation.set(wet?pose.pitch:0,0,wet?pose.roll:0);
    const step=speed*dt;f.distance+=step;f.stand.position.z=f.distance;
    // Dying (Plans/vallen-en-verdrinken.md), over and over: each body's own length, the rest after,
    // and a moment standing before it goes down again. A drowning body sinks as walk.js sinks it.
    if(mode==='fall'||mode==='drown'){
      const kind=mode, loop=f.rig.dyingSeconds(kind)+DEATH_REST+.8, t=(time-deathAt)%loop;
      const down=t<loop-.8;
      f.stand.rotation.set(0,0,0);
      f.stand.position.y=kind==='drown'?-.1-DROWN_SINK*Math.max(0,Math.min(t,loop-.8)-.3):0;
      f.rig.update(down?{dying:{kind,t},distance:0}:{grounded:true,distance:0},dt);
      continue;
    }
    if(mode==='climb'){
      f.stand.rotation.set(0,Math.PI,0);f.stand.position.y=climbY;
      ladders[figures.indexOf(f)].position.z=f.distance-CLIMB_OUT;
      if(masted&&onMast&&f===figures[climber])mast.position.set(f.stand.position.x,0,f.distance-MAST_FROM-MAST_LADDER);
      if(masted&&onNest&&f===figures[climber]){
        // the climber's spot on her ladder, CLIMB_OUT out from its ropes, onto this body's feet
        const cx=ALOFT.x+ALOFT.out[0]*CLIMB_OUT, cz=ALOFT.z+ALOFT.out[1]*CLIMB_OUT, a=nest.rotation.y;
        nest.position.set(f.stand.position.x-(cx*Math.cos(a)+cz*Math.sin(a)),-(DECK_Y+ALOFT.foot),f.distance-(-cx*Math.sin(a)+cz*Math.cos(a)));
      }
      f.rig.update({moving:climbDir!==0,grounded:true,distance:0,climbing:{rise:climbRise,at:climbY}},dt);
      f.stand.updateMatrixWorld(true);
      showHoldsFor(figures.indexOf(f),f,climbRise);
      continue;
    }
    // A jump keeps the way it took off with, as walk.js's does: the same JUMP_V and GRAVITY.
    const up=jumpAt===null?0:Math.max(0,JUMP_V*(time-jumpAt)-GRAVITY*(time-jumpAt)**2/2);
    // Above the floor where the island has it under the water, with walk.js's heave on top.
    f.stand.position.y=wet?(mode==='swim'?.18:-.1)+pose.dy+TREAD_SINK*(1-lie):up;
    const grounded=jumpAt===null||time-jumpAt>2*JUMP_V/GRAVITY;
    f.rig.update({moving:speed>0,running:mode==='run'||mode==='sprint',sprinting:mode==='sprint',swimming:mode==='swim'||mode==='tread',treading:mode==='tread'?1:0,grounded,phase:time,distance:step},dt);
  }
  // Drawn too far apart to be compared, the one behind is set level again.
  const lead=Math.max(...figures.map(f=>f.distance));
  for(const f of figures)if(lead-f.distance>1.2){f.distance=lead;f.stand.position.z=lead;}
  if(jumpAt!==null&&time-jumpAt>2*JUMP_V/GRAVITY)jumpAt=null;
  distance=riding?rider.distance:close<0?figures.reduce((a,f)=>a+f.distance,0)/figures.length:figures[close].distance;
}
function render(){
  // Camera and nearby scenery follow the actual moving body; the ground marks stay fixed.
  track.position.z=Math.floor(distance/2)*2;
  // Keep the floor centred on the moving horse.
  floor.position.z=track.position.z;
  // A rider on a horse stands twice as high and twice as long: the camera stands back and up.
  const riding=mode==='horse'&&!!horse;
  const x=riding||close<0?0:figures[close].stand.position.x, near=(close<0?1:mode==='climb'?.95:.72)*(riding?1.9:1);
  // Close up, the camera rises with a jump so the leap stays in the frame.
  const lift=riding?.3:mode==='climb'?figures[0].stand.position.y:close<0?0:figures[close].stand.position.y*.8;
  const target=new THREE.Vector3(x,(close<0?.245:.26)+lift,distance);
  camera.position.set(x+(side?1.6:1.05)*near,(close<0?.5:.36)+lift,distance+(side?.03:1.45)*near);camera.lookAt(target);
  camera.setViewOffset(innerWidth,innerHeight,close<0?-innerWidth*.13:-innerWidth*.2,0,innerWidth,innerHeight);
  sun.position.set(-2,4,distance+3);sun.target.position.copy(target);sun.target.updateMatrixWorld();
  renderer.render(scene,camera);
}
requestAnimationFrame(frame);
// A small inspection surface for the motion workbench's browser checks.
window.travellerPreview={traveller,figures,carrier,scene,camera,renderer,ladders,holdDots,get climbY(){return climbY;},set climbY(v){climbY=v;},get distance(){return distance;},get horse(){return horse;},
  // held: true stops the clock, so a check can step to one moment and look at it.
  held:false,
  advance(frames,dt=1/60){for(let i=0;i<frames;i++)tick(dt);render();}};
