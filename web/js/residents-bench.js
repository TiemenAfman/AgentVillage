// The residents' workbench (/residents.html): every pose a resident can be drawn in, standing in a
// row on one field, for the skinned body (Plans/inwoners-in-avonturierstijl.md) and - one step
// behind each - the old one, so a pose can be judged against what it was. Walkers walk on the spot;
// the drink, the swing and the flinch come round every few seconds. Nothing here is the island's:
// no sea, no walk, only createFigures and its draw(), exactly as the crowd calls them.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createBuildingMaterial } from './buildings.js';
import { createFigures, settlerLook } from './settler-figures.js';

const canvas = document.getElementById('bench');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fb9c9);
const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 100);
camera.position.set(1.2, 0.9, 3.4);
const controls = new OrbitControls(camera, canvas);
controls.target.set(1.2, 0.2, 0);
scene.add(new THREE.HemisphereLight(0xdfeeff, 0x5d6b45, 1.3));
const sun = new THREE.DirectionalLight(0xfff1d8, 2.2);
sun.position.set(2, 4, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 12 });
sun.target.position.set(1.2, 0, 0);
scene.add(sun, sun.target);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: 0x7c9a58, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const material = createBuildingMaterial();
const POSES = [
  { name: 'still', anim: 'still' },
  { name: 'walk', anim: 'walk', speed: 0.5 },
  { name: 'run', anim: 'walk', speed: 1.1 },
  { name: 'step', anim: 'step' },
  { name: 'hammer', anim: 'hammer' },
  { name: 'haul', anim: 'haul', speed: 0.5 },
  { name: 'barrow', anim: 'barrow', speed: 0.42 },
  { name: 'load', anim: 'load' },
  { name: 'carry', anim: 'carry', speed: 0.42 },
  { name: 'hoe', anim: 'hoe' },
  { name: 'weed', anim: 'weed' },
  { name: 'chop', anim: 'chop' },
  { name: 'gather', anim: 'gather' },
  { name: 'fish', anim: 'fish' },
  ...[0, 1, 2, 3, 4, 5].map((move) => ({ name: `dance ${move}`, anim: 'dance', move })),
  { name: 'sit (bench)', anim: 'sit', seat: { h: 0.135 } },
  { name: 'sit (stool)', anim: 'sit', seat: { h: 0.2, rest: 0.07 } },
  { name: 'drink', anim: 'still', every: 'drink' },
  { name: 'strike', anim: 'still', every: 'strike' },
  { name: 'flinch', anim: 'still', every: 'flinch' },
];
const PITCH = 0.32;
document.getElementById('bench-legend').textContent = POSES.map((p, i) => `${i + 1} ${p.name}`).join(' · ');

let crowds = [];
function build(armed) {
  for (const c of crowds) c.view.dispose();
  crowds = [];
  for (const [skinned, z] of [[true, 0], [false, -0.7]]) {
    const view = createFigures(scene, material, { skinned, armed });
    const figures = new Map();
    POSES.forEach((p, i) => {
      // Alternately a woman and a man, a skirt now and then, so both bodies show every pose.
      const id = `bench:${i}`;
      const look = { ...settlerLook(id, 'sonnet'), presentation: i % 2 ? 'woman' : 'man', outfit: i % 4 === 1 ? 'skirt' : 'trousers', height: 1, build: 1, head: 1 };
      const f = {
        id, visible: true, pos: [i * PITCH, z], y: 0, yaw: 0, faceAngle: 0, anim: p.anim,
        mode: p.anim === 'walk' || p.speed ? 'walk' : 'idle', speed: p.speed || 0, move: p.move, beat: 0, hype: 0.6,
        seat: p.seat, every: p.every,
      };
      if (p.seat) f.y = 0;
      view.enrol(f, look, 'adult');
      figures.set(id, f);
    });
    crowds.push({ view, figures, skinned });
  }
}
// What the sitters sit on.
for (const [i, p] of POSES.entries()) {
  if (!p.seat) continue;
  for (const z of [0, -0.7]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.14, p.seat.h, 0.1), new THREE.MeshStandardMaterial({ color: 0x8b5e3c }));
    seat.position.set(i * PITCH, p.seat.h / 2, z - 0.01);
    seat.castShadow = seat.receiveShadow = true;
    scene.add(seat);
    if (p.seat.rest) {
      const ring = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.01, 0.12), seat.material);
      ring.position.set(i * PITCH, p.seat.rest, z + 0.06);
      scene.add(ring);
    }
  }
}
build(false);

const toggle = (id, on) => document.getElementById(id).setAttribute('aria-pressed', String(on));
let showOld = true, paused = false, armed = false;
document.getElementById('bench-old').onclick = () => { showOld = !showOld; toggle('bench-old', showOld); };
document.getElementById('bench-pause').onclick = () => { paused = !paused; toggle('bench-pause', paused); };
document.getElementById('bench-armed').onclick = () => { armed = !armed; toggle('bench-armed', armed); build(armed); };

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

let last = performance.now(), clock = 0, next = 0;
function frame(now) {
  const dt = paused ? 0 : Math.min(0.05, (now - last) / 1000);
  last = now;
  clock += dt;
  const fire = clock > next;
  if (fire) next = clock + 2.6;
  for (const c of crowds) {
    for (const f of c.figures.values()) {
      f.visible = c.skinned || showOld;
      if (f.anim === 'dance') f.beat += dt * 2;
      if (fire && f.every === 'drink') c.view.drinkBeer(f);
      if (fire && f.every === 'strike') c.view.strike(f);
      if (fire && f.every === 'flinch') c.view.flinch(f);
    }
    c.view.draw(c.figures, dt);
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// For the console and a test browser: the crowds and the camera.
window.__bench = { crowds, camera, controls, POSES, PITCH };
