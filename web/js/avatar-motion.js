import * as THREE from 'three';
import { DEFAULT_AVATAR } from './avatar.js';
import { createClassicAvatar } from './classic-avatar.js';
import { WALK_SPEED, RUN_SPEED } from './avatar-gait.js';
import { createAvatarStudio } from './studio.js';

const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('#motion'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x94aa9a);
const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0x94aa9a, 4, 10);
scene.add(new THREE.HemisphereLight(0xfff3da, 0x617963, 2.2));
const sun = new THREE.DirectionalLight(0xfff4e0, 3); sun.position.set(-2, 4, 3); sun.castShadow = true;
sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-2;sun.shadow.camera.right=2;sun.shadow.camera.top=2;sun.shadow.camera.bottom=-2;sun.shadow.normalBias=.002;scene.add(sun);
const mat = new THREE.MeshStandardMaterial({ vertexColors:true, roughness:.85 });
const traveller = createClassicAvatar(DEFAULT_AVATAR, mat);
const carrier = new THREE.Group();carrier.add(traveller.object);scene.add(carrier);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({ color:0x758968, roughness:1 }));floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;scene.add(floor);
const track=new THREE.Group();scene.add(track);
for(let i=-60;i<=60;i++){
  const stripe=new THREE.Mesh(new THREE.BoxGeometry(.65,.002,.014),new THREE.MeshStandardMaterial({color:i%5===0?0xe1d5b3:0xadc09d,roughness:1}));
  stripe.position.set(0,.001,i*.2);track.add(stripe);
}
const helper=new THREE.SkeletonHelper(traveller.object);helper.visible=false;scene.add(helper);
const camera=new THREE.PerspectiveCamera(32,1,.01,100);
let mode='walk', side=false, distance=0, last=performance.now(), time=0;
const inventory=createAvatarStudio(document.body,{onApply:spec=>traveller.set(spec)});
document.querySelector('#motion-inventory').onclick=()=>inventory.open();
document.querySelector('#motion-bones').onchange=e=>helper.visible=e.target.checked;
document.querySelector('#motion-view').onclick=e=>{side=!side;e.target.textContent=side?'Driekwartaanzicht':'Zijaanzicht';};
for(const button of document.querySelectorAll('[data-gait]'))button.onclick=()=>{
  mode=button.dataset.gait;
  for(const b of document.querySelectorAll('[data-gait]'))b.setAttribute('aria-pressed',String(b===button));
  document.querySelector('#motion-note').textContent=mode==='idle'?'Stilstaan · ontspannen houding':mode==='run'?'Rennen · langere passen en meer kniebuiging':'Lopen · voeten landen, dragen het gewicht en rollen af';
};
function resize(){renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();}
addEventListener('resize',resize);resize();
function frame(now){
  const dt=Math.min(.05,(now-last)/1000);last=now;time+=dt;
  const speed=mode==='run'?RUN_SPEED:mode==='walk'?WALK_SPEED:0;
  const step=speed*dt;distance+=step;
  carrier.position.z=distance;
  traveller.update({moving:speed>0,running:mode==='run',grounded:true,phase:time,distance:step},dt);
  // Camera and nearby scenery follow the actual moving body; the ground marks stay fixed.
  track.position.z=Math.floor(distance/2)*2;
  const target=new THREE.Vector3(0,.245,distance);
  camera.position.set(side?1.3:.95,.48,distance+(side?.03:1.2));camera.lookAt(target);
  camera.setViewOffset(innerWidth,innerHeight,-innerWidth*.13,0,innerWidth,innerHeight);
  sun.position.set(-2,4,distance+3);sun.target.position.copy(target);sun.target.updateMatrixWorld();
  renderer.render(scene,camera);requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// A small inspection surface for the motion workbench's browser checks.
window.travellerPreview={traveller,carrier,scene,camera,renderer,get distance(){return distance;}};
