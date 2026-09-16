import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildBuilding, createBuildingMaterial } from './buildings.js';
import { avatarPlayerGeometry, DEFAULT_AVATAR } from './avatar.js';
const params = new URLSearchParams(location.search), modest = params.has('modest');
const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('canvas'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, modest ? 1.15 : 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = modest ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, .05, 30);
camera.position.set(2.9, 2.35, 3.6);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, .80, 0); controls.update();
controls.minDistance = 2.3; controls.maxDistance = 8;
controls.maxPolarAngle = Math.PI * .49;
const mat = createBuildingMaterial();
const built = buildBuilding({ id: 'c:tavern', kind: 'civic', civicType: 'tavern', style: 'unknown' });
const inn = new THREE.Mesh(built.geometry, mat); inn.castShadow = true; inn.receiveShadow = true; scene.add(inn);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(200,200), new THREE.MeshStandardMaterial({ color: 0x667b52, roughness: 1 }));
floor.rotation.x = -Math.PI/2; floor.receiveShadow = true; scene.add(floor);
const person = new THREE.Mesh(avatarPlayerGeometry(DEFAULT_AVATAR), mat);
person.position.set(-.48,.18,1.03); person.rotation.y = -.3; person.castShadow = true; scene.add(person);
const hemi = new THREE.HemisphereLight(0xffebc6,0x48553a,.85);scene.add(hemi);
const ambient = new THREE.AmbientLight(0xffffff,.4);scene.add(ambient);
const sun = new THREE.DirectionalLight(0xffe4b5,3);sun.castShadow = true;
sun.shadow.mapSize.setScalar(modest ? 1024 : 2048);sun.shadow.camera.left=-3;sun.shadow.camera.right=3;sun.shadow.camera.top=3;sun.shadow.camera.bottom=-3;sun.shadow.normalBias=.015;scene.add(sun);
function hour(value) {
  const night=value===21;
  mat.userData.uniforms.uNight.value=night ? 1 : value===17 ? .15 : 0;
  sun.position.set(-3,night ? 3 : value===17 ? 2 : 5,4);
  sun.color.setHex(night ? 0x9daee8 : value===17 ? 0xffc788 : 0xffedcf);
  sun.intensity=night ? .4 : 3;
  hemi.intensity=night ? .45 : .85;ambient.intensity=night ? .18 : .4;
  scene.background=new THREE.Color(night ? 0x15232e : value===17 ? 0x777d62 : 0xacc2bd);
  document.querySelectorAll('[data-hour]').forEach((b)=>b.setAttribute('aria-pressed',String(Number(b.dataset.hour)===value)));
}
document.querySelectorAll('[data-hour]').forEach((b)=>b.addEventListener('click',()=>hour(Number(b.dataset.hour))));
hour([12,17,21].includes(Number(params.get('hour'))) ? Number(params.get('hour')) : 17);
function resize(){renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();}
addEventListener('resize',resize);resize();
renderer.setAnimationLoop(()=>{
  renderer.render(scene,camera);
  document.querySelector('output').textContent=`${modest?'modest':'standard'} · ${renderer.info.render.calls} calls · taverne ${built.geometry.attributes.position.count/3} tris · 1 materiaal`;
});
