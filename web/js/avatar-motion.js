import * as THREE from 'three';
import { normalizeAvatar, loadAvatar, CHARACTERS } from './avatar.js';
import { createClassicAvatar } from './classic-avatar.js';
import { createAvatarStudio } from './studio.js';
import { swimPose, TREAD_SINK } from './diving.js';

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
  return { id: c.id, rig, stand, distance: 0 };
});
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
let jumpAt=null;
let mode='walk', side=false, distance=0, last=performance.now(), time=0, bob=0;
// The inventory dresses whichever body it has chosen; the other keeps what it had on.
const inventory=createAvatarStudio(document.body,{onApply:spec=>{for(const f of figures)if(f.id===spec.character)f.rig.set(spec);}});
document.querySelector('#motion-inventory').onclick=()=>inventory.open();
document.querySelector('#motion-bones').onchange=e=>helper.visible=e.target.checked;
// Close up on one body at a time, to judge how a hat or a strap sits: off, then each in turn.
let close=-1;
document.querySelector('#motion-close').onclick=e=>{close=close+1<figures.length?close+1:-1;e.target.textContent=close<0?'Dichtbij':CHARACTERS[close].name;};
document.querySelector('#motion-jump').onclick=()=>{if(jumpAt===null)jumpAt=time;};
document.querySelector('#motion-view').onclick=e=>{side=!side;e.target.textContent=side?'Driekwartaanzicht':'Zijaanzicht';};
for(const button of document.querySelectorAll('[data-gait]'))button.onclick=()=>{
  mode=button.dataset.gait;
  for(const b of document.querySelectorAll('[data-gait]'))b.setAttribute('aria-pressed',String(b===button));
  document.querySelector('#motion-note').textContent=mode==='idle'?'Stilstaan · ontspannen houding':mode==='run'?'Rennen · de draf als de stamina op is':mode==='sprint'?'Sprinten · Shift met stamina: voorover, lange passen, armen pompen':mode==='swim'?'Zwemmen · schoolslag, gekanteld zoals walk.js een zwemmer kantelt':mode==='tread'?'Watertrappen · stil in het water, rechtop':mode==='dig'?'Graven · met de schep':'Lopen · voeten landen, dragen het gewicht en rollen af';
};
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
  // walk.js's swimming beat: quick in the stroke, slow treading water.
  bob+=dt*(mode==='swim'?6.5:1.4);
  // Each body at its own speed (avatar-gait.js GAITS), so they draw apart: the camera follows
  // the one looked at closely, else the two's middle.
  for(const f of figures){
    const speed=mode==='sprint'?f.rig.speeds.sprint:mode==='run'?f.rig.speeds.run:mode==='walk'?f.rig.speeds.walk:mode==='swim'?SWIM_SPEED:0;
    // A dig is switched on and off with the button, as walk.js does with E at a mark.
    if((mode==='dig')!==!!f.rig.digging())f.rig.dig(mode==='dig');
    // In the water each body lies as walk.js lays it (diving.js swimPose): forward in the stroke,
    // upright treading water, and the Traveller rolling and nodding on walk.js's beat - a body
    // that swims its own stroke (`strokes`) only leans, as on the island.
    const wet=mode==='swim'||mode==='tread', lie=mode==='swim'?1:0, pose=swimPose(lie,f.rig.strokes?0:bob);
    f.stand.rotation.set(wet?pose.pitch:0,0,wet?pose.roll:0);
    const step=speed*dt;f.distance+=step;f.stand.position.z=f.distance;
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
  distance=close<0?figures.reduce((a,f)=>a+f.distance,0)/figures.length:figures[close].distance;
}
function render(){
  // Camera and nearby scenery follow the actual moving body; the ground marks stay fixed.
  track.position.z=Math.floor(distance/2)*2;
  const x=close<0?0:figures[close].stand.position.x, near=close<0?1:.72;
  // Close up, the camera rises with a jump so the leap stays in the frame.
  const lift=close<0?0:figures[close].stand.position.y*.8;
  const target=new THREE.Vector3(x,(close<0?.245:.26)+lift,distance);
  camera.position.set(x+(side?1.6:1.05)*near,(close<0?.5:.36)+lift,distance+(side?.03:1.45)*near);camera.lookAt(target);
  camera.setViewOffset(innerWidth,innerHeight,close<0?-innerWidth*.13:-innerWidth*.2,0,innerWidth,innerHeight);
  sun.position.set(-2,4,distance+3);sun.target.position.copy(target);sun.target.updateMatrixWorld();
  renderer.render(scene,camera);
}
requestAnimationFrame(frame);
// A small inspection surface for the motion workbench's browser checks.
window.travellerPreview={traveller,figures,carrier,scene,camera,renderer,get distance(){return distance;},
  // held: true stops the clock, so a check can step to one moment and look at it.
  held:false,
  advance(frames,dt=1/60){for(let i=0;i<frames;i++)tick(dt);render();}};
