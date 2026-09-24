import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { avatarPlayerGeometry, DEFAULT_AVATAR } from './avatar.js';
import { figureGeometry, styleLook, settlerLook } from './settlers.js';

const canvas = document.querySelector('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x192b29);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xfff3dc, 0x6c8b80, 2));
const key = new THREE.DirectionalLight(0xffffff, 2.5);
key.position.set(-2, 4, 5);
scene.add(key);
const camera = new THREE.PerspectiveCamera(32, 1, .01, 30);
camera.position.set(.3, .55, 1.45);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, .25, 0);
controls.enablePan = false;
controls.minDistance = .9;
controls.maxDistance = 3;
controls.update();
const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .85, flatShading: true });
const entries = [
  ['Jij', 'Reiziger · volledige uitrusting', avatarPlayerGeometry(DEFAULT_AVATAR), 1],
  ['Dorpswerker', 'Werkjas & schort', figureGeometry('sonnet', { look: { ...styleLook('sonnet'), hatShape: 'cap', hat: 0x5c8a4a } }), 1],
  ['Ambachtsvrouw', 'Opgestoken haar & werkbroek', figureGeometry('opus', { look: { ...settlerLook('showcase:opus', 'opus'), presentation: 'woman', outfit: 'trousers', hatShape: 'none' } }), 1],
  ['Dorpsbewoonster', 'Werkrok & hoofddoek', figureGeometry('fable', { look: { ...styleLook('fable'), presentation: 'woman', outfit: 'skirt', hatShape: 'band' } }), 1],
  ['Leerling', 'Kleiner, met groter hoofd', figureGeometry('haiku', { look: settlerLook('showcase:child', 'haiku', 'apprentice') }), .62],
  ['Zeeman', 'Herkenbare havenpet', figureGeometry('sonnet', { sailor: true }), 1],
];
const cards = [];
for (const [i, [name, note, geo, scale]] of entries.entries()) {
  const mesh = new THREE.Mesh(geo, material);
  mesh.scale.setScalar(scale);
  mesh.rotation.y = -.25;
  scene.add(mesh);
  const label = document.createElement('div');
  label.className = 'label';
  const title = document.createElement('strong'); title.textContent = name;
  const sub = document.createElement('small'); sub.textContent = note;
  label.append(title, sub); document.body.append(label);
  cards.push({ element: label, mesh });
}
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
}
addEventListener('resize', resize); resize();
renderer.setAnimationLoop(() => {
  renderer.setScissorTest(false);
  renderer.clear();
  renderer.setScissorTest(true);
  const columns = innerWidth < 650 ? 2 : 3;
  const rows = Math.ceil(cards.length / columns);
  const top = 170, bottom = 60;
  const width = innerWidth / columns, height = Math.max(100, (innerHeight - top - bottom) / rows);
  cards.forEach(({ mesh }) => { mesh.visible = false; });
  for (const [i, { element, mesh }] of cards.entries()) {
    const x = i % columns * width, y = innerHeight - top - (Math.floor(i / columns) + 1) * height;
    camera.aspect = width / (height - 40);
    camera.updateProjectionMatrix();
    renderer.setViewport(x, y + 40, width, height - 40);
    renderer.setScissor(x, y + 40, width, height - 40);
    mesh.visible = true;
    renderer.render(scene, camera);
    mesh.visible = false;
    element.style.left = `${x + width / 2}px`;
    element.style.top = `${innerHeight - y - 34}px`;
  }
});
