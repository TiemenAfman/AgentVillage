import * as THREE from 'three';
import { normalizeAvatar, loadAvatar, CHARACTERS } from './avatar.js';
import { createClassicAvatar, DROWN_SINK, DEATH_REST, horsebackOf } from './classic-avatar.js';
import { createAvatarStudio } from './studio.js';
import { swimPose, TREAD_SINK } from './diving.js';
import { createMount, MOUNT_TOP, MOUNT_GALLOP } from './mount.js';
import { createBuildingMaterial } from './buildings.js';

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
// Up a rope ladder (Klimmen): at CLIMB_V, as walk.js's CLIMB_SPEED, from the floor to CLIMB_TOP and
// from the bottom again; each body facing its own ladder, its feet CLIMB_OUT in front of the ropes
// (shared/deck.mjs) and the rungs a ship's RUNG_STEP apart (boat.js), seen from behind as on foot.
const CLIMB_V=.45, CLIMB_TOP=1.2, CLIMB_OUT=.16, RUNG_STEP=.2;
const ladders=figures.map(f=>{
  const g=new THREE.Group(), rope=new THREE.MeshStandardMaterial({color:0x9c7f52,roughness:1}), wood=new THREE.MeshStandardMaterial({color:0x6e4d2b,roughness:1});
  for(const x of [-.12,.12]){const r=new THREE.Mesh(new THREE.BoxGeometry(.012,CLIMB_TOP+.6,.012),rope);r.position.set(x,(CLIMB_TOP+.6)/2,0);g.add(r);}
  for(let y=.15;y<CLIMB_TOP+.55;y+=RUNG_STEP){const r=new THREE.Mesh(new THREE.BoxGeometry(.26,.012,.014),wood);r.position.y=y;g.add(r);}
  g.visible=false;g.position.x=f.stand.position.x;scene.add(g);return g;
});
let jumpAt=null, deathAt=0;
let mode='walk', side=false, distance=0, last=performance.now(), time=0, bob=0;
// The inventory dresses whichever body it has chosen; the other keeps what it had on.
const inventory=createAvatarStudio(document.body,{onApply:spec=>{for(const f of figures)if(f.id===spec.character)f.rig.set(spec);}});
document.querySelector('#motion-inventory').onclick=()=>inventory.open();
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
  document.querySelector('#motion-note').textContent=mode==='horse'?horseNote():mode==='idle'?'Stilstaan · ontspannen houding':mode==='run'?'Rennen · de draf als de stamina op is':mode==='sprint'?'Sprinten · Shift met stamina: voorover, lange passen, armen pompen':mode==='swim'?'Zwemmen · schoolslag, gekanteld zoals walk.js een zwemmer kantelt':mode==='tread'?'Watertrappen · stil in het water, rechtop':mode==='dig'?'Graven · met de schep':mode==='climb'?'Klimmen · een touwladder op, de handen en voeten per sport':mode==='fall'?'Vallen · leeg geslagen: door de knieën en voorover, steeds opnieuw':mode==='drown'?'Verdrinken · zonder lucht: rechtop, armen naar boven, zinkend':'Lopen · voeten landen, dragen het gewicht en rollen af';
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
  for(const l of ladders)l.visible=mode==='climb';
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
    f.stand.visible=!riding||f===rider;
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
      const was=f.stand.position.y, y=(time*CLIMB_V)%CLIMB_TOP;
      f.stand.rotation.set(0,Math.PI,0);f.stand.position.y=y;
      ladders[figures.indexOf(f)].position.z=f.distance-CLIMB_OUT;
      f.rig.update({moving:true,grounded:true,distance:0,climbing:{rise:y>=was?y-was:0}},dt);
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
  const x=riding||close<0?0:figures[close].stand.position.x, near=(close<0?1:.72)*(riding?1.9:1);
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
window.travellerPreview={traveller,figures,carrier,scene,camera,renderer,get distance(){return distance;},get horse(){return horse;},
  // held: true stops the clock, so a check can step to one moment and look at it.
  held:false,
  advance(frames,dt=1/60){for(let i=0;i<frames;i++)tick(dt);render();}};
