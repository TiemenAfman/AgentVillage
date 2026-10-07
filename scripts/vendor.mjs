// Copies the parts of three.js the viewer needs into web/vendor (no bundler, no CDN).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(ROOT, 'node_modules', 'three');
const dst = path.join(ROOT, 'web', 'vendor');

const files = [
  ['build/three.module.js', 'three.module.js'],
  ['build/three.core.js', 'three.core.js'],                 // only exists in newer three versions
  ['examples/jsm/controls/OrbitControls.js', 'addons/controls/OrbitControls.js'],
  ['examples/jsm/utils/BufferGeometryUtils.js', 'addons/utils/BufferGeometryUtils.js'],
  ['examples/jsm/loaders/GLTFLoader.js', 'addons/loaders/GLTFLoader.js'],   // demo page, and the volcano's imps (imp.js, lazily)
  ['examples/jsm/utils/SkeletonUtils.js', 'addons/utils/SkeletonUtils.js'],     // one skeleton per imp (imp.js, lazily)
  ['examples/jsm/controls/TransformControls.js', 'addons/controls/TransformControls.js'],   // editor only
  ['examples/jsm/renderers/CSS3DRenderer.js', 'addons/renderers/CSS3DRenderer.js'],         // the HTML panels
  // Bloom and SMAA in rooms (post.js, Plans/bloom-en-aa.md), and what they import.
  ['examples/jsm/postprocessing/EffectComposer.js', 'addons/postprocessing/EffectComposer.js'],
  ['examples/jsm/postprocessing/RenderPass.js', 'addons/postprocessing/RenderPass.js'],
  ['examples/jsm/postprocessing/ShaderPass.js', 'addons/postprocessing/ShaderPass.js'],
  ['examples/jsm/postprocessing/MaskPass.js', 'addons/postprocessing/MaskPass.js'],
  ['examples/jsm/postprocessing/Pass.js', 'addons/postprocessing/Pass.js'],
  ['examples/jsm/postprocessing/UnrealBloomPass.js', 'addons/postprocessing/UnrealBloomPass.js'],
  ['examples/jsm/postprocessing/SMAAPass.js', 'addons/postprocessing/SMAAPass.js'],
  ['examples/jsm/postprocessing/OutputPass.js', 'addons/postprocessing/OutputPass.js'],
  ['examples/jsm/shaders/CopyShader.js', 'addons/shaders/CopyShader.js'],
  ['examples/jsm/shaders/LuminosityHighPassShader.js', 'addons/shaders/LuminosityHighPassShader.js'],
  ['examples/jsm/shaders/SMAAShader.js', 'addons/shaders/SMAAShader.js'],
  ['examples/jsm/shaders/OutputShader.js', 'addons/shaders/OutputShader.js'],

  ['LICENSE', 'LICENSE'],
];

if (!fs.existsSync(src)) {
  console.error('three is not installed. Run: npm install');
  process.exit(1);
}
let copied = 0;
for (const [from, to] of files) {
  const a = path.join(src, from), b = path.join(dst, to);
  if (!fs.existsSync(a)) continue;
  fs.mkdirSync(path.dirname(b), { recursive: true });
  fs.copyFileSync(a, b);
  copied++;
}
const ver = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8')).version;
console.log(`vendored three@${ver}: ${copied} files -> web/vendor`);
