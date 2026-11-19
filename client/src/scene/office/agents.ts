// Office 房间的 agent 角色：程序化低模小人 + 动画数学（移植自 office3d characters.tsx）
// 名牌/气泡不进 rig，由 roomHost 的 HTML 标签层统一投影
import * as THREE from "three";
import { AgentInfo } from "@world3d/shared";
import { CharState } from "./agentSystem";

const SKINS = ["#ffd9c4", "#ffe3d3", "#f6c8a8", "#ffdcc8", "#f9d2b4", "#ffe8da", "#f3c1a1"];
const HAIRS = ["#3d2c24", "#5a3825", "#26211f", "#6b4a2f", "#1f2229", "#4a3020", "#312826"];

function lookFor(id: string, color: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return {
    skin: SKINS[h % SKINS.length],
    hair: HAIRS[(h >> 3) % HAIRS.length],
    accent: color,
  };
}

export interface OfficeAgentRig {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  head: THREE.Group;
}

function lam(color: string): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color });
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

/** 创建一个 agent 的小人 rig（办公室比例 ~0.95 高） */
export function createOfficeAgent(info: AgentInfo): OfficeAgentRig {
  const look = lookFor(info.id, info.color);
  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const legMat = lam("#3d4252");
  const legL = new THREE.Group();
  legL.position.set(-0.07, 0.24, 0);
  legL.add(mesh(new THREE.BoxGeometry(0.09, 0.26, 0.11), legMat, 0, -0.12, 0));
  const legR = new THREE.Group();
  legR.position.set(0.07, 0.24, 0);
  legR.add(mesh(new THREE.BoxGeometry(0.09, 0.26, 0.11), legMat, 0, -0.12, 0));
  bodyGroup.add(legL, legR);

  const accent = lam(look.accent);
  // 身体（胶囊 ≈ 圆柱+两端球，Lambert 无 capsule 时用组合）
  bodyGroup.add(mesh(new THREE.CylinderGeometry(0.155, 0.165, 0.3, 12), accent, 0, 0.44, 0));
  bodyGroup.add(mesh(new THREE.SphereGeometry(0.16, 12, 10), accent, 0, 0.32, 0));
  bodyGroup.add(mesh(new THREE.SphereGeometry(0.15, 12, 10), accent, 0, 0.56, 0));
  // PM 工牌 / 老板领带
  if (info.role === "pm") {
    const badge = mesh(new THREE.BoxGeometry(0.14, 0.1, 0.02), lam("#fff4d6"), 0, 0.5, 0.14);
    badge.rotation.x = 0.25;
    bodyGroup.add(badge);
  }
  if (info.role === "boss") {
    const tie = mesh(new THREE.BoxGeometry(0.05, 0.22, 0.02), lam("#b6454f"), 0, 0.47, 0.145);
    tie.rotation.x = 0.12;
    bodyGroup.add(tie);
  }

  const skin = lam(look.skin);
  const armL = new THREE.Group();
  armL.position.set(-0.185, 0.56, 0);
  armL.add(mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.16, 8), accent, 0, -0.1, 0));
  armL.add(mesh(new THREE.SphereGeometry(0.055, 10, 8), skin, 0, -0.22, 0));
  const armR = new THREE.Group();
  armR.position.set(0.185, 0.56, 0);
  armR.add(mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.16, 8), accent, 0, -0.1, 0));
  armR.add(mesh(new THREE.SphereGeometry(0.055, 10, 8), skin, 0, -0.22, 0));
  bodyGroup.add(armL, armR);

  const head = new THREE.Group();
  head.position.set(0, 0.72, 0);
  head.add(mesh(new THREE.SphereGeometry(0.185, 16, 14), skin));
  const hair = mesh(new THREE.SphereGeometry(0.19, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.56), lam(look.hair), 0, 0.035, -0.012);
  hair.scale.set(1.06, 0.82, 1.06);
  head.add(hair);
  const back = mesh(new THREE.SphereGeometry(0.165, 12, 10), lam(look.hair), 0, -0.02, -0.06);
  back.scale.set(1, 0.9, 0.9);
  head.add(back);
  const eyeMat = lam("#2b2b33");
  head.add(mesh(new THREE.SphereGeometry(0.017, 8, 6), eyeMat, -0.062, 0, 0.168));
  head.add(mesh(new THREE.SphereGeometry(0.017, 8, 6), eyeMat, 0.062, 0, 0.168));
  const blush = new THREE.MeshLambertMaterial({ color: "#f7a8a0", transparent: true, opacity: 0.65 });
  head.add(mesh(new THREE.SphereGeometry(0.024, 8, 6), blush, -0.098, -0.045, 0.15));
  head.add(mesh(new THREE.SphereGeometry(0.024, 8, 6), blush, 0.098, -0.045, 0.15));
  bodyGroup.add(head);

  return { root, bodyGroup, legL, legR, armL, armR, head };
}

/** 每帧动画：状态来自 charSystem（移植自 office3d 的 useFrame 数学） */
export function animateOfficeAgent(rig: OfficeAgentRig, st: CharState, info: AgentInfo, t: number) {
  rig.root.position.set(st.x, st.y, st.z);
  rig.root.rotation.y = st.rotY;
  const bg = rig.bodyGroup;

  if (st.anim === "walk") {
    const w = Math.sin(t * 11);
    bg.position.y = Math.abs(Math.sin(t * 11)) * 0.045;
    bg.rotation.x = 0.06;
    rig.legL.rotation.x = w * 0.65;
    rig.legR.rotation.x = -w * 0.65;
    rig.armL.rotation.x = -w * 0.5;
    rig.armR.rotation.x = w * 0.5;
    rig.head.rotation.z = Math.sin(t * 5.5) * 0.04;
    rig.head.rotation.x = 0;
  } else if (st.anim === "sit") {
    bg.position.y = 0;
    bg.rotation.x = 0.02;
    rig.legL.rotation.x = -1.35;
    rig.legR.rotation.x = -1.35;
    const typing = info.activity === "working";
    rig.armL.rotation.x = typing ? -0.9 + Math.sin(t * 13) * 0.12 : -0.25;
    rig.armR.rotation.x = typing ? -0.9 + Math.cos(t * 11) * 0.12 : -0.25;
    rig.head.rotation.x = typing ? 0.18 : Math.sin(t * 1.4) * 0.05;
    rig.head.rotation.z = 0;
  } else if (st.anim === "talk") {
    bg.position.y = Math.abs(Math.sin(t * 6)) * 0.02;
    bg.rotation.x = 0;
    rig.legL.rotation.x = 0;
    rig.legR.rotation.x = 0;
    rig.armL.rotation.x = -0.15;
    rig.armR.rotation.x = -1.9 + Math.sin(t * 8) * 0.35;
    rig.head.rotation.z = Math.sin(t * 7) * 0.06;
    rig.head.rotation.x = 0;
  } else if (st.anim === "work") {
    bg.position.y = Math.sin(t * 12) * 0.012;
    bg.rotation.x = 0.14;
    rig.legL.rotation.x = 0;
    rig.legR.rotation.x = 0;
    rig.armL.rotation.x = -1.0 + Math.sin(t * 14) * 0.1;
    rig.armR.rotation.x = -1.0 + Math.cos(t * 12) * 0.1;
    rig.head.rotation.x = 0.22;
    rig.head.rotation.z = 0;
  } else {
    bg.position.y = Math.sin(t * 2 + info.id.length) * 0.012;
    bg.rotation.x = 0;
    rig.legL.rotation.x = 0;
    rig.legR.rotation.x = 0;
    rig.armL.rotation.x = Math.sin(t * 2.2) * 0.06;
    rig.armR.rotation.x = -Math.sin(t * 2.2) * 0.06;
    rig.head.rotation.x = 0;
    rig.head.rotation.z = Math.sin(t * 0.9) * 0.03;
  }
}
