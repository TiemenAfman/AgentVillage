// Blender's closed horse surfaces, deformed by its exported armature. Every mesh shares
// this skeleton; a sleeve-like blend at a hip/neck keeps the buried root on the torso.
import * as THREE from 'three';
import { FAUNA } from './fauna-mesh.js';
import { HORSE_GRAZE } from './fauna.js';
import { hoofPath, horseCadence } from './horse-gait.js';

export const HORSE_RIG = FAUNA.rigs?.horse;
const v = () => new THREE.Vector3();
const target=v(), d=v(), pole=v(), knee=v(), upper=v(), lower=v();
const unBody=new THREE.Quaternion(), parentQ=new THREE.Quaternion();
const bodyEuler=new THREE.Euler(0,0,0,'YXZ');
const flexQ=new THREE.Quaternion(), X=new THREE.Vector3(1,0,0);
const path = {};
// The island's material is flat; the horse's exported skin normals want it smooth. One twin per
// source, shared by every horse (one program), its hooks unbound since they read `this`, and
// `seeThroughOff` carried over: the ridden horse comes in as buildings.js solidMaterial and
// must stay solid, the stable's keeps the island's cone (tests/ridden-see-through.test.mjs).
const smoothOf=new WeakMap();
export function smoothHorseMaterial(material) {
  if (!material.flatShading) return material;
  let smooth=smoothOf.get(material);
  if (!smooth) {
    smooth=material.clone();
    smooth.flatShading=false;
    smooth.userData=material.userData;
    smooth.onBeforeCompile=material.onBeforeCompile;
    smooth.customProgramCacheKey=material.customProgramCacheKey;
    if (material.seeThroughOff) smooth.seeThroughOff=true;
    smoothOf.set(material,smooth);
  }
  return smooth;
}

export function bindHorse(a, material) {
  if (!HORSE_RIG) return null;
  const definition=HORSE_RIG;
  const bones=definition.bones.map((b) => {
    const bone=new THREE.Bone(); bone.name='horse:'+b.name;
    bone.position.fromArray(b.at);
    if (b.parent>=0) bone.position.sub(new THREE.Vector3(...definition.bones[b.parent].at));
    return bone;
  });
  definition.bones.forEach((b,i)=>(b.parent>=0?bones[b.parent]:a.object).add(bones[i]));
  const skeleton=new THREE.Skeleton(bones);
  const smooth=smoothHorseMaterial(material);
  const meshes=[];
  for (const part of a.joints) {
    const old=part.pivot.children[0];
    const mesh=new THREE.SkinnedMesh(old.geometry,smooth);
    mesh.castShadow=true; mesh.frustumCulled=false;
    part.pivot.remove(old); part.pivot.add(mesh);
    meshes.push(mesh);
  }
  a.object.updateMatrixWorld(true);
  for (const mesh of meshes) mesh.bind(skeleton);
  const legs=definition.legs.map((l)=>{
    const hip=new THREE.Vector3(...definition.bones[l.root].at);
    const bend=new THREE.Vector3(...definition.bones[l.bend].at);
    const foot=new THREE.Vector3(...definition.bones[l.end].at);
    return {...l,hip,foot,u:bend.clone().sub(hip),l:foot.clone().sub(bend),
      upper:bones[l.root],lower:bones[l.bend],hoof:bones[l.end]};
  });
  a.head=bones[definition.neck]; a.tail=bones[definition.tail];
  a.legs=legs.map(l=>l.upper);
  return {bones,skeleton,legs,meshes,dispose(){skeleton.dispose();}};
}

function solve(leg, wanted, unBody, flex=0) {
  d.copy(wanted).sub(leg.hip);
  const l1=leg.u.length(),l2=leg.l.length();
  const distance=Math.min(d.length(),l1+l2-.000001);
  d.normalize();
  const along=(l1*l1-l2*l2+distance*distance)/(2*Math.max(.001,distance));
  const height=Math.sqrt(Math.max(0,l1*l1-along*along));
  pole.set(0,0,leg.front?1:-1).addScaledVector(d,-d.z*(leg.front?1:-1)).normalize();
  knee.copy(leg.hip).addScaledVector(d,along).addScaledVector(pole,height);
  upper.copy(knee).sub(leg.hip).normalize();
  leg.upper.quaternion.setFromUnitVectors(target.copy(leg.u).normalize(),upper);
  lower.copy(leg.hip).addScaledVector(d,distance).sub(knee).normalize();
  parentQ.copy(leg.upper.quaternion).invert();
  leg.lower.quaternion.setFromUnitVectors(target.copy(leg.l).normalize(),lower.applyQuaternion(parentQ));
  // A loaded hoof stays level even while the back pitches or banks. The fetlock takes
  // the resulting flex rather than rocking the sole through the ground.
  leg.hoof.quaternion.copy(leg.upper.quaternion).multiply(leg.lower.quaternion).invert().multiply(unBody);
  // Lifted, the fetlock folds: toe down and back, the sole showing behind (Preston Blair's
  // trot and gallop sheets), by the gait's `flex`, in the level frame so a loaded hoof is still
  // flat on the ground at 0.
  if (flex) leg.hoof.quaternion.multiply(flexQ.setFromAxisAngle(X, flex));
}

export function poseHorse(a) {
  const p=a.pose,rig=a.horseRig,b=rig.bones;
  const g=p.graze||0;
  b[1].rotation.set(p.headX*.7+g*HORSE_GRAZE.neck,p.headY*.7,0);
  b[2].rotation.set(p.headX*.3+g*HORSE_GRAZE.head,p.headY*.3,0);
  b[3].rotation.set(p.tailX,0,p.tailZ);
  b[4].rotation.set(p.tailX*.2,0,p.tailZ*.35);
  bodyEuler.set(p.bodyX,0,p.bodyZ);
  unBody.setFromEuler(bodyEuler).invert();
  const special=p.low>.15||p.rear>.1;
  for (let i=0;i<rig.legs.length;i++) {
    const leg=rig.legs[i];
    if (special) {
      leg.upper.rotation.set(p.legs[i]||0,0,0);
      // Reared, the hinds hang straight: stepDance lifts the body by exactly what a stiff leg
      // swung back by the lean puts under the floor, so a bent hock would stand it in the air.
      leg.lower.rotation.set(leg.front?.8:p.rear>.1?0:-.8,0,0);
      leg.hoof.rotation.set(0,0,0);
      continue;
    }
    let foot=p.hooves?.[i];
    if (!foot && p.act==='dance') {
      // The rave (fauna.js stepDance) still speaks the stiff legs' language: a swing of the
      // whole leg about the hip, forward negative. Read it as where that leg's hoof went.
      const swing=p.legs[i]||0, reach=leg.hip.y;
      path.z=-Math.sin(swing)*reach; path.y=(1-Math.cos(swing))*reach;
      path.flex=Math.min(1,path.y/.03)*(leg.front?1:.4); path.contact=path.y<.001;
      foot=path;
    } else if (!foot) {
      const moving=p.act==='walk' || p.act==='hurry';
      const speed=moving?(p.horseSpeed||.22):0;
      foot=hoofPath(p.horseCycle||0,i,speed,'walk',horseCadence(speed,'walk'),path);
    }
    target.copy(leg.foot);
    target.z+=foot.z;
    target.y=leg.sole+foot.y-p.bodyY;
    target.applyQuaternion(unBody);
    // `solve` uses target as scratch after it has copied the requested point.
    solve(leg,target,unBody,foot.flex||0);
  }
}
