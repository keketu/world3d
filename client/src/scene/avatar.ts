// 程序化 Q 版小人（移植自 office3d 的画法，简化为原生 three）
import * as THREE from "three";
import { mergeParts } from "./mergeParts";

const SKINS = ["#ffd9c4", "#ffe3d3", "#f6c8a8", "#ffdcc8", "#f9d2b4"];
const HAIRS = ["#3d2c24", "#5a3825", "#26211f", "#6b4a2f", "#1f2229"];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export interface Avatar {
  group: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  bodyGroup: THREE.Group;
  head: THREE.Group;
}

export function createAvatar(name: string, color: string): Avatar {
  const h = hashStr(name + color);
  const skin = SKINS[h % SKINS.length];
  const hair = HAIRS[(h >> 3) % HAIRS.length];

  const group = new THREE.Group();
  const bodyGroup = new THREE.Group();
  group.add(bodyGroup);

  const stdMat = (c: string) => new THREE.MeshLambertMaterial({ color: c });

  // 腿
  const legL = new THREE.Group();
  legL.position.set(-0.07, 0.24, 0);
  const legMeshL = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.26, 0.11), stdMat("#3d4252"));
  legMeshL.position.y = -0.12;
  legL.add(legMeshL);
  bodyGroup.add(legL);

  const legR = new THREE.Group();
  legR.position.set(0.07, 0.24, 0);
  const legMeshR = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.26, 0.11), stdMat("#3d4252"));
  legMeshR.position.y = -0.12;
  legR.add(legMeshR);
  bodyGroup.add(legR);

  // 身体
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.155, 0.24, 6, 12), stdMat(color));
  body.position.y = 0.42;
  bodyGroup.add(body);

  // 手臂
  const armL = new THREE.Group();
  armL.position.set(-0.185, 0.56, 0);
  const armMeshL = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.14, 4, 8), stdMat(color));
  armMeshL.position.y = -0.11;
  armL.add(armMeshL);
  const handL = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 10), stdMat(skin));
  handL.position.y = -0.22;
  armL.add(handL);
  bodyGroup.add(armL);

  const armR = new THREE.Group();
  armR.position.set(0.185, 0.56, 0);
  const armMeshR = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.14, 4, 8), stdMat(color));
  armMeshR.position.y = -0.11;
  armR.add(armMeshR);
  const handR = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 10), stdMat(skin));
  handR.position.y = -0.22;
  armR.add(handR);
  bodyGroup.add(armR);

  // 头
  const head = new THREE.Group();
  head.position.y = 0.72;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.185, 18, 18), stdMat(skin));
  head.add(skull);
  const hairCap = new THREE.Mesh(
    new THREE.SphereGeometry(0.19, 18, 18, 0, Math.PI * 2, 0, Math.PI * 0.56),
    stdMat(hair)
  );
  hairCap.position.set(0, 0.035, -0.012);
  hairCap.scale.set(1.06, 0.82, 1.06);
  head.add(hairCap);
  const hairBack = new THREE.Mesh(new THREE.SphereGeometry(0.165, 14, 14), stdMat(hair));
  hairBack.position.set(0, -0.02, -0.06);
  hairBack.scale.set(1, 0.9, 0.9);
  head.add(hairBack);
  const eyeMat = stdMat("#2b2b33");
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.017, 8, 8), eyeMat);
  eyeL.position.set(-0.062, 0, 0.168);
  head.add(eyeL);
  const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.017, 8, 8), eyeMat);
  eyeR.position.set(0.062, 0, 0.168);
  head.add(eyeR);
  // 嘴：小圆点
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 8), stdMat("#a85454"));
  mouth.position.set(0.01, -0.062, 0.172);
  head.add(mouth);
  // 腮红：两颗粉点
  const blushMat = stdMat("#f0a8a0");
  const blushL = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 8), blushMat);
  blushL.position.set(-0.098, -0.045, 0.15);
  head.add(blushL);
  const blushR = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 8), blushMat);
  blushR.position.set(0.098, -0.045, 0.15);
  head.add(blushR);
  // 帽子（三成角色有）：鸭舌帽/毛线帽
  const hatRoll = h % 10;
  if (hatRoll < 3) {
    const hatColors = ["#c65f76", "#5b8def", "#7bb98a", "#e8a05a"];
    const hatC = hatColors[hatRoll % hatColors.length];
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 14), stdMat(hatC));
    brim.position.set(0, 0.14, 0.03);
    head.add(brim);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.185, 14, 14, 0, Math.PI * 2, 0, Math.PI * 0.42), stdMat(hatC));
    cap.position.set(0, 0.13, -0.01);
    cap.scale.set(1.02, 0.9, 1.02);
    head.add(cap);
  }
  // 领口/腰带
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.17, 0.05, 12), stdMat("#f7f4ea"));
  collar.position.y = 0.53;
  bodyGroup.add(collar);
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.165, 0.165, 0.045, 12), stdMat("#3d4252"));
  belt.position.y = 0.33;
  bodyGroup.add(belt);
  bodyGroup.add(head);

  return { group, legL, legR, armL, armR, bodyGroup, head };
}

/**
 * 小人瘦身：每个肢体里的若干小网格各自合成 1 个顶点色网格（约 20 → 7 个 draw call）
 * 各肢体的枢轴不变，animateAvatar 照常驱动；材质按小人独立一份（离线半透明要逐人改）
 */
export function compactAvatar(av: Avatar) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mergeGroup = (g: THREE.Group) => {
    const meshes = g.children.filter((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh);
    if (meshes.length < 2) return;
    const geo = mergeParts(meshes);
    for (const m of meshes) g.remove(m);
    const merged = new THREE.Mesh(geo, mat);
    merged.castShadow = true;
    g.add(merged);
  };
  // 头不单独做动画（只随身体转），先把它并进身体，少一个 draw call
  if (av.head.parent === av.bodyGroup) {
    av.head.updateMatrix();
    for (const c of [...av.head.children]) {
      if ((c as THREE.Mesh).isMesh) {
        c.applyMatrix4(av.head.matrix);
        av.bodyGroup.add(c);
      }
    }
    av.bodyGroup.remove(av.head);
  }
  mergeGroup(av.legL);
  mergeGroup(av.legR);
  mergeGroup(av.armL);
  mergeGroup(av.armR);
  mergeGroup(av.bodyGroup);
}

/** 行走/待机动画（每帧调用） */
export function animateAvatar(av: Avatar, anim: "idle" | "walk", time: number) {
  if (anim === "walk") {
    const w = Math.sin(time * 11);
    av.bodyGroup.position.y = Math.abs(Math.sin(time * 11)) * 0.045;
    av.bodyGroup.rotation.x = 0.06;
    av.legL.rotation.x = w * 0.65;
    av.legR.rotation.x = -w * 0.65;
    av.armL.rotation.x = -w * 0.5;
    av.armR.rotation.x = w * 0.5;
  } else {
    av.bodyGroup.position.y = Math.sin(time * 2) * 0.012;
    av.bodyGroup.rotation.x = 0;
    av.legL.rotation.x = 0;
    av.legR.rotation.x = 0;
    av.armL.rotation.x = Math.sin(time * 2.2) * 0.06;
    av.armR.rotation.x = -Math.sin(time * 2.2) * 0.06;
  }
}

/** 离线驻留外观：整体半透明（材质为每实例独立创建，可安全改；仅状态切换时调用一次） */
export function setAvatarOffline(av: Avatar, off: boolean) {
  av.group.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined;
    if (m && typeof m.opacity === "number") {
      m.transparent = off;
      m.opacity = off ? 0.45 : 1;
    }
  });
}
