import * as THREE from 'three';
import { normalizeAvatar, loadAvatar, CHARACTERS, bodyKey } from './avatar.js';
import { createClassicAvatar, DROWN_SINK, DEATH_REST, CLIMB_SPEED, horsebackOf, stepWay } from './classic-avatar.js';
import { createAvatarStudio } from './studio.js';
import { loadWanderers } from './player-bodies.js';
import { swimPose, TREAD_SINK } from './diving.js';
import { loadSet } from './models.js';
import { meshAsset, createBuildingMaterial } from './buildings.js';
import { createMount, gaitShare, MOUNT_TOP, MOUNT_GALLOP } from './mount.js';
import { createPool, spendPool, canBoost, HORSE } from './stamina.js';
import { KIT, MAST_LADDER, MAST_FROM } from './kraken-layout.js';
import { RUNG_STEP, RUNG_R, RUNG_OUT } from 'shared/deck.mjs';
import { CRAFTS } from 'shared/crafts.mjs';
import { DECK_Y } from 'shared/hull.mjs';
import { createBoat, SHIP_SURFACE } from './boat.js';
import { climbWay, climbWayDown, climbAlong, onWay, ladderLanding, facingOnWay, hoistAt, HOIST_PACE, HANG_GAP } from './ladder-way.js';
import { pathAt, ladderPath, deckAt, aloftPath } from 'shared/deck.mjs';
import { nearestStand } from 'shared/hullwalk.mjs';
import { ROPE_WALK, ROPE_HANG } from 'shared/harpoon.mjs';
import { createMixamoCatalogue } from './mixamo-catalogue.js';

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
// The Wanderer's man and woman too (Plans/basislichamen-en-outfits.md), as the Adventurer with a body.
// A workbench waits for their bodies (player-bodies.js loadWanderers, lazy on the island) rather than
// showing the Adventurer in their place first.
await loadWanderers({ now: true });
const figures = CHARACTERS.map((c, i) => {
  const look = normalizeAvatar(c.wanderer ? { ...saved, character: 'adventurer', body: c.sex } : { ...saved, character: c.id, body: null });
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
const HORSE_GAITS=[['stilstaan',0],['draf',MOUNT_TOP],['galop',MOUNT_TOP*MOUNT_GALLOP],['grazen',0],['dansen',0]];
// The rave's tempo (rave.js, 132 BPM), for Paard · dansen.
const RAVE_BPS=132/60;
// Use the island material, including the horse's exported smooth skin normals.
const horseMat=createBuildingMaterial();
let horse=null, horseGait=1, horseHelper=null;
// The horse's own breath (stamina.js HORSE), spent by the gait as walk.js's ride spends it
// (mount.js gaitShare): a gallop on an empty pool is a trot, and the bar under the controls says
// how much is left and how long it lasts at this gait - for judging the tempo. Vol and Leeg set it.
const horsePool=createPool(HORSE);
const staminaBar=document.querySelector('#motion-stamina');
document.querySelector('#motion-stamina-fill').onclick=()=>{horsePool.level=1;horsePool.spent=false;horsePool.rest=Infinity;};
document.querySelector('#motion-stamina-empty').onclick=()=>{horsePool.level=0;horsePool.spent=true;horsePool.rest=0;};
function showHorsePool(riding,share){
  staminaBar.hidden=!riding;
  if(!riding)return;
  staminaBar.querySelector('i').style.transform=`scaleX(${horsePool.level})`;
  staminaBar.classList.toggle('spent',horsePool.spent);
  const left=share>0?`nog ${(horsePool.level*HORSE.drain/share).toFixed(0)} s in deze gang`:horsePool.level<1?`vol over ${((1-horsePool.level)*HORSE.refill).toFixed(0)} s`:'vol';
  staminaBar.querySelector('#motion-stamina-text').textContent=`${Math.round(horsePool.level*100)}%${horsePool.spent?' · op, geen galop':''} · ${left}`;
}
// ?rider=wanderer-female puts somebody else on the horse.
const rider=figures.find(f=>f.id===(new URLSearchParams(location.search).get('rider')||'adventurer'))||figures.find(f=>f.id==='adventurer');
const seatAt=new THREE.Vector3();
const traveller = figures[0].rig;
// The Mixamo catalogue (web/js/mixamo-catalogue.js): every clip of the keeper's library, played on one
// of the bodies that play clips (not the Traveller, whose walk is his own). While a clip plays it owns
// the stage: that one body, standing where it stands, the clip's hips' travel added when In Place is off.
const trialBodies=figures.filter(f=>f.id!=='traveller');
const catalogue=createMixamoCatalogue({bodies:trialBodies.map(f=>({id:f.id,name:CHARACTERS.find(c=>c.id===f.id).name+(f.id.startsWith('wanderer-')?f.id.endsWith('female')?' (vrouw)':' (man)':'')}))});
let trialAt=null;
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
// Or on and off a ladder (Op- en afstappen, Plans/DONE/ladder-op-en-af.md): each body walks up to the foot
// of a rope ladder, steps onto it (Start Climbing Ladder on the Adventurer), climbs it, comes up over
// its top onto a plank (Climbing Up A Ladder To Standing), stands, and goes back down it to the floor -
// along web/js/ladder-way.js's way, which is walk.js's, so this is the climb the island draws at the
// Salty Kraken's ladder up its hull (a plank STEP_LAND past the rungs, as there).
let onStep=false;
const STEP_H=24*RUNG_STEP, STEP_LAND=.46, STEP_FROM=.3, STEP_REST=.9;
const stepRope=[{x:0,y:0,z:0},{x:0,y:STEP_H+.06,z:0},{x:0,y:STEP_H,z:-STEP_LAND}];
const stepUp=climbWay(stepRope,{x:0,y:0,z:STEP_FROM}), stepDown=climbWayDown(stepRope,{x:0,y:STEP_H,z:-STEP_LAND});
const stepState={dir:1,d:0,rest:STEP_REST};
const stepRigs=figures.map(f=>{
  const g=new THREE.Group();
  for(const x of [-ROPE_HW,ROPE_HW]){const r=new THREE.Mesh(new THREE.BoxGeometry(.012,STEP_H+.08,.012),ropeMat);r.position.set(x,(STEP_H+.08)/2,RUNG_OUT-CLIMB_OUT);g.add(r);}
  for(let k=1;k*RUNG_STEP<STEP_H+.01;k++){const r=new THREE.Mesh(new THREE.BoxGeometry(2*ROPE_HW+.012,2*RUNG_R,2*RUNG_R),ropeMat);r.position.set(0,k*RUNG_STEP,RUNG_OUT-CLIMB_OUT);g.add(r);}
  // the plank the ladder leads up to, from just behind its ropes on past where the way lands
  const plank=new THREE.Mesh(new THREE.BoxGeometry(.3,.04,STEP_LAND+.4),new THREE.MeshStandardMaterial({color:0x7a5a3a,roughness:1}));
  plank.position.set(0,STEP_H-.02,RUNG_OUT-CLIMB_OUT-.02-(STEP_LAND+.4)/2);plank.castShadow=plank.receiveShadow=true;g.add(plank);
  g.visible=false;scene.add(g);return g;
});
// One step of it, for every body alike: up, a rest on the plank, down, a rest on the floor.
function wayTick(st,up,down,dt){
  const w=st.dir>0?up:down;
  if(st.rest>0){st.rest-=dt;return {w,moving:false};}
  const was=st.d;
  st.d=climbAlong(w,st.d,st.dir>0?1:-1,dt);
  if(st.dir>0&&st.d>=w.len){Object.assign(st,{dir:-1,d:down.len,rest:STEP_REST});return {w,moving:true};}
  if(st.dir<0&&st.d<=0){Object.assign(st,{dir:1,d:0,rest:STEP_REST});return {w,moving:true};}
  return {w,moving:st.d!==was};
}
const stepTick=dt=>wayTick(stepState,stepUp,stepDown,dt);
// Or in through a port in the bulwark (Poortladder, Plans/DONE/nieuwe-sloep.md): the sloop's own starboard entry
// port and its rope ladder, as boat.js hangs it on her hull. The body climbs it from the floor (the
// ladder's foot, rung 0) and steps straight in over the sill along web/js/ladder-way.js's way, whose end is
// where walk.js lands (ladderLanding, asked of her walk map), and down again; so this is the climb the
// island draws there.
let onPort=false, port=null;
const PORT_LADDER=CRAFTS.galleon.ladders.find(q=>q.x>0);
const PORT_SPEC=CRAFTS.galleon;
const portRope=ladderPath(PORT_SPEC,PORT_LADDER,PORT_LADDER.foot);
portRope[portRope.length-1]=ladderLanding(SHIP_SURFACE,PORT_SPEC,PORT_LADDER);
const portUp=climbWay(portRope,{x:portRope[0].x+STEP_FROM,y:portRope[0].y,z:portRope[0].z}), portDown=climbWayDown(portRope,portRope[portRope.length-1]);
const portState={dir:1,d:0,rest:STEP_REST};
const portTick=dt=>wayTick(portState,portUp,portDown,dt);
// The hull's frame onto the workbench: her starboard side towards the climber, so her -x (into her) is the
// body's -z, the way every ladder here is faced. A turn of yaw sends (x, z) to (x cos + z sin, -x sin + z cos).
const PORT_YAW=-Math.PI/2;
const portTurn=(x,z)=>[x*Math.cos(PORT_YAW)+z*Math.sin(PORT_YAW),-x*Math.sin(PORT_YAW)+z*Math.cos(PORT_YAW)];
const shipMaterial=()=>new THREE.MeshStandardMaterial({vertexColors:true,roughness:.9,flatShading:true});
function showPort(){
  if(port)return;
  // her ladders are welded into her hull by boat.js, from the same numbers the climb follows
  port=createBoat({scene,material:shipMaterial(),kind:'ship'}).object;
  port.visible=false;port.receiveShadow=true;port.rotation.y=PORT_YAW;
}
// Or up the sloop's mast through the lubber's hole (Lubbergat, Plans/DONE/nieuwe-sloep.md): her pins, baked
// into her hull, from the deck up through the hole in the top's floor and a step aside onto it beside the
// hole - the step over the top played by Mixamo's Climbing Up A Ladder To Standing as on every ladder,
// the body turning to it (ladder-way.js facingOnWay) since the mast is ahead - and back down. The way and
// its end are walk.js's: aloftPath, and her walk map's nearest place to stand where it lands.
let onHole=false, holeShip=null;
const HOLE=CRAFTS.galleon.aloft[0];
const holeRope=aloftPath(HOLE);
{const end=holeRope[holeRope.length-1], at=nearestStand(SHIP_SURFACE,end.x,end.z,end.y+.05);if(at)holeRope[holeRope.length-1]={x:at.x,y:at.y,z:at.z};}
const holeFrom={x:holeRope[0].x+HOLE.out[0]*.12,y:holeRope[0].y,z:holeRope[0].z+HOLE.out[1]*.12};
const holeUp=climbWay(holeRope,holeFrom), holeDown=climbWayDown(holeRope,holeRope[holeRope.length-1]);
const holeState={dir:1,d:0,rest:STEP_REST};
const holeTick=dt=>wayTick(holeState,holeUp,holeDown,dt);
// Her frame onto the workbench: the way the climber faces the pins (-out) is the body's -z.
const HOLE_YAW=Math.atan2(HOLE.out[0],-HOLE.out[1]);
const holeTurn=(x,z)=>[x*Math.cos(HOLE_YAW)+z*Math.sin(HOLE_YAW),-x*Math.sin(HOLE_YAW)+z*Math.cos(HOLE_YAW)];
function showHole(){
  if(holeShip)return;
  holeShip=createBoat({scene,material:shipMaterial(),kind:'ship'}).object;
  holeShip.visible=false;holeShip.receiveShadow=true;holeShip.rotation.y=HOLE_YAW;
}
// Out of the water onto planks (Uitklimmen, walk.js climbOut): each body treading water at the edge of
// a jetty, Space, and up onto it by Mixamo's Freehang Climb To Standing along ladder-way.js hoistAt -
// walk.js's own way, at its HOIST_PACE - a rest standing on the planks, and back in the water. The
// planks are QUAY_DECK over the sea, OUT_H over a swimmer's feet (0.44 + walk.js's SWIM_SINK 0.07),
// their edge OUT_EDGE ahead and the landing where walk.js would put it.
// The workbench's floor is solid, and a swimmer treading water hangs TREAD_SINK under the feet: so the
// sea, the jetty and the climb all stand OUT_BASE up.
const OUT_H=.51, OUT_EDGE=.3, OUT_LAND=.3+.12+.05+.1, OUT_TREAD=1.2, OUT_STAND=1, OUT_EASE=.5, OUT_BASE=TREAD_SINK+.08;
const outRigs=figures.map(()=>{
  const g=new THREE.Group();
  const wood=new THREE.MeshStandardMaterial({color:0x7a5a3a,roughness:1}), dark=new THREE.MeshStandardMaterial({color:0x4f3823,roughness:1});
  // a jetty as the island draws one: boards across on two stringers, on piles down into the sea
  const W=1, L=1.6;
  for(let k=0;k*.11<L;k++){const board=new THREE.Mesh(new THREE.BoxGeometry(W,.035,.1),wood);board.position.set(0,OUT_H-.0175,-OUT_EDGE-.05-k*.11);board.castShadow=board.receiveShadow=true;g.add(board);}
  for(const x of [-W/2+.08,W/2-.08]){const s=new THREE.Mesh(new THREE.BoxGeometry(.06,.07,L),dark);s.position.set(x,OUT_H-.07,-OUT_EDGE-L/2);g.add(s);}
  for(const x of [-W/2+.08,W/2-.08])for(const z of [-OUT_EDGE-.04,-OUT_EDGE-L+.06]){const pile=new THREE.Mesh(new THREE.CylinderGeometry(.035,.04,OUT_H+OUT_BASE,10),dark);pile.position.set(x,(OUT_H-OUT_BASE)/2,z);pile.castShadow=true;g.add(pile);}
  // and the sea round it, down to the studio's floor: its surface where a swimmer floats (SWIM_SINK)
  const water=new THREE.Mesh(new THREE.BoxGeometry(3,OUT_BASE+.07,3.4),new THREE.MeshStandardMaterial({color:0x2f6f8f,transparent:true,opacity:.5,roughness:.2,depthWrite:false}));
  water.position.set(0,(.07-OUT_BASE)/2,-.4);g.add(water);
  g.visible=false;scene.add(g);return g;
});
function outTick(f,dt){
  const step=stepWay('climbOut'), climb=step?step.seconds/HOIST_PACE:1.5, loop=OUT_TREAD+climb+OUT_STAND, t=(time-deathAt)%loop;
  outRigs[figures.indexOf(f)].position.set(f.stand.position.x,OUT_BASE,f.distance);
  f.stand.rotation.set(0,Math.PI,0);
  const tread=swimPose(0,f.rig.strokes?0:bob), treadY=OUT_BASE+tread.dy;
  if(t<OUT_TREAD){
    f.stand.position.set(f.x,treadY,f.distance);
    f.rig.update({moving:false,grounded:true,swimming:true,treading:1,distance:0},dt);
    return;
  }
  const u=Math.min(1,(t-OUT_TREAD)/climb);
  const p=step?hoistAt(step,{x:0,y:0,z:HANG_GAP-OUT_EDGE},{x:0,y:OUT_H,z:-OUT_LAND},u,undefined,{x:0,z:0}):{x:0,y:OUT_H*u,z:-OUT_LAND*u};
  // walk.js eases the drawn body up from where the swimmer was drawn (stepOffEase): so here
  const e=Math.min(1,(t-OUT_TREAD)/OUT_EASE), k=e*e*(3-2*e);
  f.stand.position.set(f.x,treadY+(OUT_BASE+p.y-treadY)*k,f.distance+p.z);
  f.rig.update(u<1?{moving:false,grounded:true,distance:0,onLadder:true,climbing:{rise:0,out:u}}:{moving:false,grounded:true,distance:0},dt);
}
let jumpAt=null, deathAt=0;
for(const button of document.querySelectorAll('[data-climb]'))button.onclick=()=>{
  climbDir=Number(button.dataset.climb);
  for(const b of document.querySelectorAll('[data-climb]'))b.setAttribute('aria-pressed',String(b===button));
};
for(const button of document.querySelectorAll('[data-ladder]'))button.onclick=()=>{
  onMast=button.dataset.ladder==='mast';onNest=button.dataset.ladder==='nest';onStep=button.dataset.ladder==='step';onPort=button.dataset.ladder==='port';onHole=button.dataset.ladder==='hole';climbY=0;
  Object.assign(stepState,{dir:1,d:0,rest:STEP_REST});
  Object.assign(portState,{dir:1,d:0,rest:STEP_REST});
  Object.assign(holeState,{dir:1,d:0,rest:STEP_REST});
  if(onHole)showHole();
  if(onMast)showMast();
  if(onNest)showNest();
  if(onPort)showPort();
  for(const b of document.querySelectorAll('[data-ladder]'))b.setAttribute('aria-pressed',String(b===button));
};
let mode='walk', side=false, distance=0, last=performance.now(), time=0, bob=0;
// The inventory dresses whichever body it has chosen; the other keeps what it had on.
const inventory=createAvatarStudio(document.body,{onApply:spec=>{for(const f of figures)if(f.id===bodyKey(spec))f.rig.set(spec);}});
document.querySelector('#motion-inventory').onclick=()=>inventory.open();
document.querySelector('#motion-mixamo').onclick=()=>catalogue.toggle();
document.querySelector('#motion-holds').onchange=e=>{showHolds=e.target.checked;};
document.querySelector('#motion-bones').onchange=e=>{helper.visible=e.target.checked;if(horseHelper)horseHelper.visible=e.target.checked;};
// Close up on one body at a time, to judge how a hat or a strap sits: off, then each in turn.
let close=-1;
document.querySelector('#motion-close').onclick=e=>{close=close+1<figures.length?close+1:-1;e.target.textContent=close<0?'Dichtbij':CHARACTERS[close].name;};
document.querySelector('#motion-jump').onclick=()=>{if(jumpAt===null)jumpAt=time;};
// The treasure statue in both arms (Plans/schatkaarten.md): lifting it and setting it down are a stoop
// (classic-avatar.js setCarry), and carried it is a slow walk - judge both here, as walk.js's H and E do.
document.querySelector('#motion-carry').onclick=e=>{
  const on=!figures[0].rig.carrying();
  for(const f of figures)f.rig.setCarry(on);
  e.target.textContent=on?'Beeld neerzetten':'Beeld optillen';
  document.querySelector('#motion-note').textContent=on?'Optillen · bukken, het beeld laag in de handen, en ermee omhoog':'Neerzetten · bukken met lege handen tot de grond, en weer rechtop';
};
document.querySelector('#motion-view').onclick=e=>{side=!side;e.target.textContent=side?'Driekwartaanzicht':'Zijaanzicht';};
const horseNote=()=>{const[name,speed]=HORSE_GAITS[horseGait];return`Paard · ${name}${speed?` op ${speed.toFixed(1)} per seconde`:''} · alleen de Avonturier rijdt (F); Sprint of Shift is galop; Paard wisselt stilstaan, draf, grazen en dansen (zoals in de rave)`;};
for(const button of document.querySelectorAll('[data-gait]'))button.onclick=()=>{
  if(button.dataset.gait==='sprint'&&mode==='horse') {
    horseGait=horseGait===2?1:2;
    document.querySelector('#motion-note').textContent=horseNote();
    syncHorseControls();
    return;
  }
  // Paard goes round standing, the trot and grazing (the head down to the grass, fauna.js HORSE_GRAZE).
  if(button.dataset.gait==='horse'&&mode==='horse')horseGait=horseGait===0?1:horseGait===1?3:horseGait===3?4:0;
  if(button.dataset.gait==='horse')button.textContent=`Paard · ${HORSE_GAITS[horseGait][0]}`;
  mode=button.dataset.gait;
  deathAt=time;
  for(const b of document.querySelectorAll('[data-gait]'))b.setAttribute('aria-pressed',String(b===button));
  document.querySelector('#motion-note').textContent=mode==='horse'?horseNote():mode==='idle'?'Stilstaan · ontspannen houding':mode==='run'?'Rennen · de draf als de stamina op is':mode==='sprint'?'Sprinten · Shift met stamina: voorover, lange passen, armen pompen':mode==='swim'?'Zwemmen · schoolslag, gekanteld zoals walk.js een zwemmer kantelt':mode==='tread'?'Watertrappen · stil in het water, rechtop':mode==='dig'?'Graven · met de schep':mode==='climb'?'Klimmen · een touwladder op: elke hand en voet pakt om de andere sport, en staat stil op die sport terwijl het lijf stijgt':mode==='fall'?'Vallen · leeg geslagen: door de knieën en voorover, steeds opnieuw':mode==='drown'?'Verdrinken · zonder lucht: rechtop, armen naar boven, zinkend':mode==='cannon'?'Afgevuurd · uit een kanon: opgerold en kopje-over langs de boog, zoals walk.js een afgevuurd lijf draait':mode==='rope'?'Touwlopen · over een strakke harpoenlijn: voet voor voet, armen opzij (Mixamo Careful Walk op afstand; de Reiziger procedureel)':mode==='out'?'Uitklimmen · uit het water op een steiger (Spatie aan de rand): de Avonturier met Freehang Climb To Standing (Mixamo), de Reiziger met zijn klimgreep':mode==='zip'?'Zipline · aan een steile harpoenlijn naar beneden glijden, hangend aan de handen (Mixamo Hanging By Hands Gently Swaying)':'Lopen · voeten landen, dragen het gewicht en rollen af';
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
  const trial=catalogue.frame(dt);
  trialAt=trial?trialTick(trial,dt):null;
  if(trial)return;
  const masted=mode==='climb'&&(onMast||onNest||onPort||onHole), climber=close<0?0:close;
  // Climbing close up (Dichtbij) shows the one body and its ladder alone: from the side the other
  // stands in front of it.
  for(const [i,l] of ladders.entries())l.visible=mode==='climb'&&!onMast&&!onNest&&!onStep&&!onPort&&!onHole&&(close<0||i===climber);
  for(const [i,g] of stepRigs.entries())g.visible=mode==='climb'&&onStep&&(close<0||i===climber);
  for(const [i,g] of outRigs.entries())g.visible=mode==='out'&&(close<0||i===climber);
  const stepped=mode==='climb'&&onStep?stepTick(dt):null;
  const ported=mode==='climb'&&onPort?portTick(dt):null;
  const holed=mode==='climb'&&onHole?holeTick(dt):null;
  if(mode!=='climb')for(const dots of holdDots)for(const d of dots){d.m.visible=false;d.was=null;}
  if(mast)mast.visible=masted&&onMast;
  if(nest)nest.visible=masted&&onNest;
  if(port)port.visible=masted&&onPort;
  if(holeShip)holeShip.visible=masted&&onHole;
  for(const [i,f] of figures.entries())f.stand.visible=(mode==='climb'||mode==='out')&&(masted||close>=0)?i===climber:true;
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
  if(!riding){spendPool(horsePool,0,dt);showHorsePool(false,0);}
  // Each body at its own speed (avatar-gait.js GAITS), so they draw apart: the camera follows
  // the one looked at closely, else the two's middle.
  for(const f of figures){
    const speed=mode==='sprint'?f.rig.speeds.sprint:mode==='run'?f.rig.speeds.run:mode==='walk'?f.rig.speeds.walk:mode==='swim'?SWIM_SPEED:mode==='rope'?ROPE_WALK:0;
    // A dig is switched on and off with the button, as walk.js does with E at a mark.
    if((mode==='dig')!==!!f.rig.digging())f.rig.dig(mode==='dig');
    // Only what the climb put on her back comes off when the climb ends; Beeld optillen keeps hers.
    if(mode!=='climb'&&f.backLaden){f.rig.setCarry(false);f.backLaden=false;}
    if(riding)f.stand.visible=f===rider;
    if(riding){
      if(f!==rider)continue;
      // Blown, a gallop asked for is a trot, as stepMount makes it on the island.
      const speed=horseGait===2&&!canBoost(horsePool)?MOUNT_TOP:HORSE_GAITS[horseGait][1];
      const share=gaitShare(speed);
      spendPool(horsePool,share,dt);
      showHorsePool(true,share);
      f.distance+=speed*dt;
      horse.place(0,0,f.distance,0);
      horse.pose({speed,graze:horseGait===3,dance:horseGait===4?time*RAVE_BPS:null},dt);
      const motion=horse.carry(f.stand,f.rig.hipY,horsebackOf(f.id).perch,dt);
      f.rig.update({moving:false,grounded:true,horseback:motion,distance:0},dt);
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
    // Fired out of a gun (Plans/kanonnen.md): a stretch of the arc walk.js launchSelf flies, over and
    // over - tucked (the rig's crouch) and head over heels about the middle of the body at walk.js's
    // LAUNCH_SPIN, as its afterMove turns a launched body.
    // On a harpoon's line (Plans/harpoen.md): walked flat at walk.js's ROPE_WALK, arms out; or hanging
    // from it sliding down (Mixamo's Hanging By Hands Gently Swaying), the feet ROPE_HANG under a line drawn over the head.
    if(mode==='rope'||mode==='zip'){
      f.stand.rotation.set(0,0,0);
      const zip=mode==='zip';
      f.stand.position.set(f.x,zip?.55-ROPE_HANG:0,f.distance);
      f.rig.update({moving:!zip,grounded:true,distance:zip?0:step,phase:time,roping:mode==='rope'?'walk':'zip',climbing:zip?{rise:0}:null},dt);
      continue;
    }
    if(mode==='cannon'){
      const T=1.6, t=time%T, mid=f.rig.hipY||.25;
      f.stand.rotation.set(t*11,0,0);
      const off=new THREE.Vector3(0,mid,0).applyEuler(f.stand.rotation);
      // A low arc and a short one, scaled to the studio's frame (the island's is some 3 up and 26 on).
      f.stand.position.set(f.x-off.x, 4*.45*(t/T)*(1-t/T)+mid-off.y, f.distance+t*.6-off.z);
      f.rig.update({crouching:true,grounded:false,distance:0},dt);
      continue;
    }
    if(mode==='out'){outTick(f,dt);continue;}
    if(ported&&f===figures[climber]){
      // where the way has the feet, in her frame, turned onto this body's track: her ladder's foot on the
      // floor under the body's own spot; facing her (-z) all along, as walk.js faces the hull
      const p=pathAt(ported.w.path,portState.d,{x:0,y:0,z:0}), on=onWay(ported.w,portState.d);
      const [fx,fz]=portTurn(portRope[0].x,portRope[0].z), [px,pz]=portTurn(p.x,p.z);
      port.position.set(f.x-fx,-(DECK_Y+PORT_LADDER.foot),f.distance-fz);
      f.stand.rotation.set(0,Math.PI,0);f.stand.position.set(port.position.x+px,p.y-PORT_LADDER.foot,port.position.z+pz);
      const rise=p.y-(f.stepY??p.y), step=Math.hypot(p.x-(f.stepAt?.x??p.x),p.z-(f.stepAt?.z??p.z));
      f.stepY=p.y;f.stepAt={x:p.x,z:p.z};
      f.rig.update({moving:ported.moving&&!on,grounded:true,distance:on?0:step,onLadder:portState.rest<=0||!!on,
        climbing:on?{rise,at:p.y-PORT_LADDER.foot,top:on.top,floor:true}:null},dt);
      continue;
    }
    if(holed&&f===figures[climber]){
      // where the way has the feet, in her frame, turned onto this body's track: the pins' foot on the
      // floor under the body's own spot; facing the mast, and turning to the step aside out of the hole
      const p=pathAt(holed.w.path,holeState.d,{x:0,y:0,z:0}), on=onWay(holed.w,holeState.d);
      const [fx,fz]=holeTurn(holeRope[0].x,holeRope[0].z), [px,pz]=holeTurn(p.x,p.z);
      holeShip.position.set(f.x-fx,-(DECK_Y+HOLE.foot),f.distance-fz);
      const face=facingOnWay(holed.w,holeState.d,[-HOLE.out[0],-HOLE.out[1]]), [wx,wz]=holeTurn(face[0],face[1]);
      f.stand.rotation.set(0,Math.atan2(wx,wz),0);f.stand.position.set(holeShip.position.x+px,p.y-HOLE.foot,holeShip.position.z+pz);
      const rise=p.y-(f.stepY??p.y), step=Math.hypot(p.x-(f.stepAt?.x??p.x),p.z-(f.stepAt?.z??p.z));
      f.stepY=p.y;f.stepAt={x:p.x,z:p.z};
      f.rig.update({moving:holed.moving&&!on,grounded:true,distance:on?0:step,onLadder:holeState.rest<=0||!!on,
        climbing:on?{rise,at:p.y-HOLE.foot,top:on.top,floor:true}:null},dt);
      continue;
    }
    if(stepped){
      // where the way has the feet, from this body's own spot; facing the ladder (-z) all along
      const p=pathAt(stepped.w.path,stepState.d,{x:0,y:0,z:0}), on=onWay(stepped.w,stepState.d);
      stepRigs[figures.indexOf(f)].position.set(f.stand.position.x,0,f.distance);
      f.stand.rotation.set(0,Math.PI,0);f.stand.position.set(f.x,p.y,f.distance+p.z);
      const rise=p.y-(f.stepY??p.y), step=Math.hypot(p.x-(f.stepAt?.x??p.x),p.z-(f.stepAt?.z??p.z));
      f.stepY=p.y;f.stepAt={x:p.x,z:p.z};
      f.rig.update({moving:stepped.moving&&!on,grounded:true,distance:on?0:step,onLadder:stepState.rest<=0||!!on,
        climbing:on?{rise,at:p.y,top:on.top,floor:true}:null},dt);
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
      // With the statue (Met de schatkist): on the back for the climb, as walk.js carries her up a ladder.
      const laden=document.querySelector('#motion-carry-back').checked;
      // only on a change of the box, so a statue lifted with Beeld optillen climbs on the back too
      if(laden!==!!f.backLaden){f.rig.setCarry(laden);f.backLaden=laden;}
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
// An orbit over whatever framing the mode chose: drag on the picture to turn round the body, the
// wheel to come closer or stand back, a double click to go back to the mode's own view.
const orbit={yaw:0,pitch:0,zoom:1};
const orbitOffset=new THREE.Vector3(), orbitSph=new THREE.Spherical();
{
  const canvas=renderer.domElement;
  let dragging=null;
  canvas.addEventListener('pointerdown',e=>{dragging={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener('pointermove',e=>{
    if(!dragging)return;
    orbit.yaw-=(e.clientX-dragging.x)*.008;orbit.pitch+=(e.clientY-dragging.y)*.006;
    dragging={x:e.clientX,y:e.clientY};
  });
  canvas.addEventListener('pointerup',()=>{dragging=null;});
  canvas.addEventListener('wheel',e=>{e.preventDefault();orbit.zoom=Math.max(.2,Math.min(6,orbit.zoom*Math.exp(e.deltaY*.0012)));},{passive:false});
  canvas.addEventListener('dblclick',()=>{orbit.yaw=0;orbit.pitch=0;orbit.zoom=1;});
}
const controlsPanel=document.querySelector('.motion-controls');
// One step of a clip under trial: everything else put away, the chosen body alone on the track.
function trialTick(trial,dt){
  for(const l of ladders)l.visible=false;
  for(const g of stepRigs)g.visible=false;
  for(const dots of holdDots)for(const d of dots){d.m.visible=false;d.was=null;}
  if(mast)mast.visible=false;
  if(nest)nest.visible=false;
  if(port)port.visible=false;
  if(holeShip)holeShip.visible=false;
  if(horse)horse.visible=false;
  showHorsePool(false,0);
  document.querySelector('#motion-climb').hidden=true;
  const chosen=trialBodies[trial.body]||trialBodies[0];
  for(const f of figures){
    f.stand.visible=f===chosen;
    if(f!==chosen)continue;
    if(f.rig.digging())f.rig.dig(false);
    const hip=f.rig.hipY||.25;
    f.stand.rotation.set(0,0,0);
    f.stand.position.set(f.x+trial.travel[0]*hip,0,f.distance+trial.travel[1]*hip);
    f.rig.update({preview:{clip:trial.clip,u:trial.u},grounded:true,moving:false,distance:0},dt);
  }
  return chosen.stand.position;
}
function render(){
  // Camera and nearby scenery follow the actual moving body; the ground marks stay fixed.
  track.position.z=Math.floor(distance/2)*2;
  // Keep the floor centred on the moving horse.
  floor.position.z=track.position.z;
  // A rider on a horse stands twice as high and twice as long: the camera stands back and up.
  const riding=mode==='horse'&&!!horse;
  const x=riding||close<0?0:figures[close].stand.position.x, near=(mode==='out'?.8:close<0?1:mode==='climb'?.95:.72)*(riding?1.9:1);
  // Close up, the camera rises with a jump so the leap stays in the frame.
  if(trialAt){
    const at=trialAt;
    // between the two panels: a little left of the middle, since the catalogue is the wider
    camera.position.set(at.x+(side?1.6:1.05)*.9,.42,at.z+(side?.03:1.45)*.9);camera.lookAt(at.x,.26,at.z);
    camera.setViewOffset(innerWidth,innerHeight,innerWidth*.04,0,innerWidth,innerHeight);
    track.position.z=Math.floor(at.z/2)*2;floor.position.z=track.position.z;
    sun.position.set(-2,4,at.z+3);sun.target.position.set(at.x,.26,at.z);sun.target.updateMatrixWorld();
    renderer.render(scene,camera);
    return;
  }
  // out of the water the camera stays by the jetty's height, rising half as far as the body: the climb is
  // judged against the planks
  const lift=riding?.3:mode==='out'?OUT_BASE+.2+Math.max(0,figures[close<0?0:close].stand.position.y-OUT_BASE)*.5:mode==='climb'?figures[0].stand.position.y:close<0?0:figures[close].stand.position.y*.8;
  // out of the water the climb goes forward onto the planks: look at the edge, not at the swimmer
  const target=new THREE.Vector3(x,(close<0?.245:.26)+lift,distance-(mode==='out'?.25:0));
  camera.position.set(x+(side?1.6:1.05)*near,(close<0?.5:.36)+lift,target.z+(side?.03:1.45)*near);
  // and the orbit on top of that framing: dragged round the target, scrolled in and out
  orbitOffset.subVectors(camera.position,target);
  orbitSph.setFromVector3(orbitOffset);
  orbitSph.theta+=orbit.yaw;
  orbitSph.phi=Math.max(.08,Math.min(Math.PI-.08,orbitSph.phi-orbit.pitch));
  orbitSph.radius*=orbit.zoom;
  camera.position.copy(target).add(orbitOffset.setFromSpherical(orbitSph));
  camera.lookAt(target);
  // shifted off the controls panel, while it is shown
  const panelShown=controlsPanel.style.display!=='none';
  camera.setViewOffset(innerWidth,innerHeight,!panelShown?0:close<0?-innerWidth*.13:-innerWidth*.2,0,innerWidth,innerHeight);
  sun.position.set(-2,4,distance+3);sun.target.position.copy(target);sun.target.updateMatrixWorld();
  renderer.render(scene,camera);
}
requestAnimationFrame(frame);
// A small inspection surface for the motion workbench's browser checks.
window.travellerPreview={catalogue,traveller,figures,carrier,scene,camera,renderer,ladders,holdDots,orbit,holeState,holeUp,holeDown,get climbY(){return climbY;},set climbY(v){climbY=v;},get distance(){return distance;},get horse(){return horse;},
  // held: true stops the clock, so a check can step to one moment and look at it.
  held:false,
  advance(frames,dt=1/60){for(let i=0;i<frames;i++)tick(dt);render();}};
