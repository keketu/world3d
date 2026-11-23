// 街景零件库：纯几何（顶点色），由 townDressing 合批成整块网格
// 约定：每个零件的局部坐标原点在地面中心，+z 为正面；发亮件（灯罩/信号灯）走 glow 通道
import * as THREE from "three";

export type Parts = THREE.Mesh[];

const matCache = new Map<number, THREE.MeshLambertMaterial>();
function M(color: number): THREE.MeshLambertMaterial {
  let m = matCache.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color });
    matCache.set(color, m);
  }
  return m;
}

/** 零件构建上下文：solid = 普通件；glow(tag) = 自发光件，按 tag 分组（可整组开关，如红绿灯） */
export interface Kit {
  solid: Parts;
  glows: Map<string, Parts>;
  glow(tag: string): Parts;
}

export function newKit(): Kit {
  const glows = new Map<string, Parts>();
  return {
    solid: [],
    glows,
    glow(tag) {
      let arr = glows.get(tag);
      if (!arr) {
        arr = [];
        glows.set(tag, arr);
      }
      return arr;
    },
  };
}

// ---------- 基础几何 ----------

export function bx(p: Parts, w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0, ry = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M(color));
  m.position.set(x, y, z);
  if (ry) m.rotation.y = ry;
  p.push(m);
  return m;
}
export function cy(p: Parts, rt: number, rb: number, h: number, color: number, x = 0, y = 0, z = 0, seg = 8): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), M(color));
  m.position.set(x, y, z);
  p.push(m);
  return m;
}
export function sp(p: Parts, r: number, color: number, x = 0, y = 0, z = 0, sy = 1, seg = 9): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(6, seg - 2)), M(color));
  m.position.set(x, y, z);
  m.scale.y = sy;
  p.push(m);
  return m;
}
export function cn(p: Parts, r: number, h: number, color: number, x = 0, y = 0, z = 0, seg = 7): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), M(color));
  m.position.set(x, y, z);
  p.push(m);
  return m;
}

const WOOD = 0xc99a62;
const IRON = 0x3d4249;
const STONE = 0xb9b3a6;
const LEAF = [0x5fa864, 0x6fb86f, 0x549a5c];
/** bench() 推入的网格数（调用方整体挪位时用） */
const BENCH_PARTS = 9;

// ---------- 树木 ----------

export function treeCherry(p: Parts) {
  cy(p, 0.13, 0.2, 1.9, 0x7a5240, 0, 0.95, 0);
  cy(p, 0.07, 0.11, 0.9, 0x7a5240, 0.28, 1.5, 0);
  sp(p, 0.95, 0xf5aec6, 0, 2.5, 0, 1.15, 10);
  sp(p, 0.62, 0xf7bcd2, 0.55, 2.15, 0.3);
  sp(p, 0.55, 0xf19cc0, -0.5, 2.3, -0.35);
  sp(p, 0.5, 0xfad4e2, 0.1, 3.25, -0.15);
  sp(p, 0.34, 0xfad4e2, -0.35, 2.9, 0.3);
}

export function treeRound(p: Parts, tone = 0) {
  cy(p, 0.16, 0.24, 1.5, 0x7d5b3d, 0, 0.75, 0);
  sp(p, 1.3, LEAF[tone % 3], 0, 2.45, 0, 1.1, 10);
  sp(p, 0.72, 0x4e9450, -0.5, 1.95, -0.3);
  sp(p, 0.62, 0x6fb86f, 0.55, 2.1, 0.4);
  sp(p, 0.45, 0x6fb86f, 0.1, 3.0, -0.2);
}

export function treeBirch(p: Parts) {
  cy(p, 0.1, 0.15, 2.2, 0xe3ddd0, 0, 1.1, 0);
  cy(p, 0.155, 0.155, 0.05, 0x3a352e, 0, 0.5, 0);
  cy(p, 0.14, 0.14, 0.05, 0x3a352e, 0, 1.0, 0);
  cy(p, 0.125, 0.125, 0.05, 0x3a352e, 0, 1.5, 0);
  sp(p, 0.95, 0x8cc06a, 0, 2.6, 0, 1.1, 10);
  sp(p, 0.5, 0xa5cf7e, 0.45, 2.15, 0.3);
  sp(p, 0.42, 0x7cb35e, -0.4, 2.3, -0.3);
}

export function treePine(p: Parts) {
  cy(p, 0.12, 0.18, 0.9, 0x6b4a2f, 0, 0.45, 0);
  cn(p, 1.35, 1.1, 0x3a7550, 0, 1.35, 0);
  cn(p, 1.05, 1.0, 0x45855c, 0, 2.05, 0);
  cn(p, 0.72, 0.9, 0x3a7550, 0, 2.75, 0);
  cn(p, 0.16, 0.5, 0x2c5e40, 0, 3.35, 0);
}

export function bush(p: Parts, tone = 0, flowers = 0) {
  sp(p, 0.7, LEAF[tone % 3], 0, 0.45, 0, 0.85);
  sp(p, 0.5, LEAF[(tone + 1) % 3], 0.5, 0.36, 0.2, 0.85);
  sp(p, 0.45, LEAF[(tone + 2) % 3], -0.45, 0.34, -0.15, 0.85);
  if (flowers) {
    const cols = [0xf07a9a, 0xf2d060, 0xf4f1ea, 0xe98a5c];
    for (let i = 0; i < 5; i++) sp(p, 0.07, cols[(i + flowers) % 4], Math.sin(i * 2.4) * 0.55, 0.62 + (i % 2) * 0.18, Math.cos(i * 2.4) * 0.5, 1, 6);
  }
}

/** 树池：人行道上给行道树围的方形护框 */
export function treeGrate(p: Parts) {
  bx(p, 1.3, 0.04, 1.3, 0x5b5a52, 0, 0.02, 0);
  bx(p, 0.9, 0.05, 0.9, 0x4a3a2c, 0, 0.03, 0);
}

// ---------- 街具 ----------

/** 长椅：正面（+z）是座位朝向 */
export function bench(p: Parts) {
  bx(p, 0.08, 0.42, 0.5, IRON, -0.75, 0.21, 0);
  bx(p, 0.08, 0.42, 0.5, IRON, 0.75, 0.21, 0);
  bx(p, 0.08, 0.5, 0.07, IRON, -0.75, 0.66, -0.2);
  bx(p, 0.08, 0.5, 0.07, IRON, 0.75, 0.66, -0.2);
  for (const z of [-0.15, 0.03, 0.21]) bx(p, 1.7, 0.05, 0.15, WOOD, 0, 0.44, z);
  bx(p, 1.7, 0.13, 0.05, WOOD, 0, 0.68, -0.2);
  bx(p, 1.7, 0.13, 0.05, WOOD, 0, 0.86, -0.2);
}

export function bollard(p: Parts) {
  cy(p, 0.07, 0.08, 0.8, 0x4a4f57, 0, 0.4, 0, 7);
  cy(p, 0.082, 0.082, 0.09, 0xf1efe8, 0, 0.64, 0, 7);
  sp(p, 0.075, 0x4a4f57, 0, 0.8, 0, 1, 6);
}

export function trashBin(p: Parts) {
  cy(p, 0.27, 0.23, 0.72, 0x3f6b5c, 0, 0.36, 0);
  cy(p, 0.29, 0.29, 0.07, 0x2f343a, 0, 0.75, 0);
  cy(p, 0.12, 0.12, 0.03, 0x1d2024, 0, 0.79, 0);
}

export function planter(p: Parts, tone = 0, flowers = 0) {
  bx(p, 1.25, 0.52, 0.55, 0xb77a5a, 0, 0.26, 0);
  bx(p, 1.1, 0.05, 0.42, 0x4a3a2c, 0, 0.53, 0);
  bushScaled(p, tone, flowers, 0.62);
}
function bushScaled(p: Parts, tone: number, flowers: number, s: number) {
  const tmp: Parts = [];
  bush(tmp, tone, flowers);
  for (const m of tmp) {
    m.position.multiplyScalar(s);
    m.position.y += 0.5;
    m.scale.multiplyScalar(s);
    p.push(m);
  }
}

export function hydrant(p: Parts) {
  cy(p, 0.12, 0.13, 0.5, 0xd8493e, 0, 0.27, 0);
  cy(p, 0.15, 0.15, 0.07, 0xb93a31, 0, 0.09, 0);
  bx(p, 0.42, 0.09, 0.09, 0xb93a31, 0, 0.36, 0);
  sp(p, 0.11, 0xd8493e, 0, 0.56, 0, 1, 6);
  cy(p, 0.05, 0.05, 0.07, 0xf1efe8, 0, 0.64, 0, 6);
}

export function postBox(p: Parts) {
  cy(p, 0.05, 0.05, 0.8, 0x3d4249, 0, 0.4, 0, 6);
  bx(p, 0.56, 0.62, 0.42, 0xd8493e, 0, 1.05, 0);
  bx(p, 0.4, 0.05, 0.03, 0x1d2024, 0, 1.24, 0.215);
  bx(p, 0.6, 0.06, 0.46, 0xb93a31, 0, 1.39, 0);
}

/** 自行车：车长沿 x，车头在 +x */
export function bicycle(p: Parts, color: number) {
  const wheel = (x: number) => {
    const w = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.04, 5, 12), M(0x22262c));
    w.rotation.y = Math.PI / 2;
    w.position.set(x, 0.32, 0);
    p.push(w);
  };
  wheel(-0.4);
  wheel(0.4);
  bx(p, 0.06, 0.5, 0.06, color, 0.34, 0.5, 0);
  bx(p, 0.06, 0.4, 0.06, color, -0.3, 0.52, 0);
  bx(p, 0.72, 0.05, 0.05, color, 0, 0.68, 0);
  bx(p, 0.38, 0.05, 0.05, color, 0, 0.82, 0);
  bx(p, 0.05, 0.05, 0.42, IRON, 0.38, 0.82, 0);
  bx(p, 0.28, 0.07, 0.13, 0x2b2b33, -0.3, 0.74, 0);
  bx(p, 0.3, 0.2, 0.26, 0x8a8f96, 0.4, 0.74, 0);
}

/** 自行车架 + 两辆车（架沿 x 排开，车身朝 +z） */
export function bikeRack(k: Kit, tone: number) {
  const p = k.solid;
  for (const x of [-0.75, 0, 0.75]) {
    bx(p, 0.05, 0.7, 0.05, 0x9aa0a8, x, 0.35, -0.35);
    bx(p, 0.05, 0.7, 0.05, 0x9aa0a8, x, 0.35, 0.35);
    bx(p, 0.05, 0.05, 0.75, 0x9aa0a8, x, 0.7, 0);
  }
  const colors = [0xc9503e, 0x3a6ea8, 0x4f8f6a, 0xd9a23a];
  const rot = new THREE.Matrix4().makeRotationY(-Math.PI / 2); // 车身从沿 x 转到沿 z
  [-0.38, 0.38].forEach((x, i) => {
    const bike: Parts = [];
    bicycle(bike, colors[(tone + i) % 4]);
    for (const m of bike) {
      m.applyMatrix4(rot);
      m.position.x += x;
      p.push(m);
    }
  });
}

/** 公交站：开口朝 −z（车道一侧） */
export function busStop(k: Kit) {
  const p = k.solid;
  bx(p, 0.09, 2.5, 0.09, IRON, -1.45, 1.25, 0.35);
  bx(p, 0.09, 2.5, 0.09, IRON, 1.45, 1.25, 0.35);
  bx(p, 3.3, 0.09, 1.4, 0xe8e4da, 0, 2.55, 0.05);
  bx(p, 3.0, 0.07, 0.95, 0x3a6ea8, 0, 2.64, 0.05);
  bx(p, 2.8, 1.75, 0.05, 0xbfe0ea, 0, 1.3, 0.6);
  bench(p);
  for (const m of p.slice(-BENCH_PARTS)) m.position.z -= 0.05;
  cy(p, 0.04, 0.04, 2.7, IRON, 1.95, 1.35, -0.2, 6);
  cy(p, 0.3, 0.3, 0.05, 0x3a6ea8, 1.95, 2.65, -0.2, 14).rotation.x = Math.PI / 2;
  cy(p, 0.2, 0.2, 0.06, 0xf1efe8, 1.95, 2.65, -0.2, 14).rotation.x = Math.PI / 2;
}

/**
 * 红绿灯：灯杆在原点，横臂沿局部 +x 伸出，灯头悬在臂下、灯面朝局部 −z
 * 该轴向（ew / ns）通行时亮绿灯，否则亮红灯；黄灯常灭。亮灯走 glow 通道，由交通相位整组开关
 */
export function trafficLight(k: Kit, axis: "ew" | "ns") {
  const p = k.solid;
  cy(p, 0.15, 0.17, 0.3, 0x6f6a60, 0, 0.15, 0);
  cy(p, 0.07, 0.09, 5.4, 0x8a9099, 0, 2.85, 0, 7);
  bx(p, 4.9, 0.09, 0.09, 0x8a9099, 2.45, 5.45, 0);
  bx(p, 1.0, 0.36, 0.24, 0x5c626b, 4.35, 5.1, 0);
  bx(p, 0.06, 0.26, 0.06, 0x8a9099, 4.35, 5.36, 0);
  // 三个灯位：红 / 黄 / 绿
  bx(p, 0.27, 0.27, 0.03, 0x1d2024, 4.04, 5.1, -0.125);
  bx(p, 0.27, 0.27, 0.03, 0x1d2024, 4.35, 5.1, -0.125);
  bx(p, 0.27, 0.27, 0.03, 0x1d2024, 4.66, 5.1, -0.125);
  bx(k.glow(`${axis}R`), 0.2, 0.2, 0.04, 0xff4b3e, 4.04, 5.1, -0.135);
  bx(p, 0.2, 0.2, 0.04, 0x6b5a2a, 4.35, 5.1, -0.135);
  bx(k.glow(`${axis}G`), 0.2, 0.2, 0.04, 0x4ee06a, 4.66, 5.1, -0.135);
  // 路名牌：两块交叉的绿牌
  bx(p, 1.15, 0.24, 0.05, 0x2f7d4f, 0.1, 3.05, 0);
  bx(p, 1.15, 0.24, 0.05, 0x2f7d4f, 0, 3.05, 0.1, Math.PI / 2);
}

// ---------- 车辆 ----------

export const CAR_COLORS = [0xf2f3f5, 0xc9ced4, 0x2a2d33, 0xd6453d, 0x3a6fb0, 0x27406b, 0x8fd0c0, 0xf0c24a, 0xe6d7b8, 0xe8833a];

/** 轿车：车长沿 x，车头在 +x；variant 1 = 面包车/MPV */
export function car(p: Parts, color: number, variant = 0) {
  if (variant === 1) {
    bx(p, 3.9, 1.15, 1.72, color, 0, 0.92, 0);
    bx(p, 1.25, 0.6, 1.6, 0x2f3b4a, 0.75, 1.55, 0);
    bx(p, 1.9, 0.5, 1.62, 0x2f3b4a, -0.75, 1.55, 0);
    bx(p, 3.5, 0.07, 1.56, color, -0.05, 1.86, 0);
  } else {
    bx(p, 4.0, 0.55, 1.76, color, 0, 0.62, 0);
    bx(p, 2.0, 0.52, 1.6, 0x2f3b4a, -0.25, 1.13, 0);
    bx(p, 1.7, 0.07, 1.5, color, -0.25, 1.42, 0);
  }
  for (const [x, z] of [[1.3, 0.86], [1.3, -0.86], [-1.3, 0.86], [-1.3, -0.86]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.22, 10), M(0x1e2126));
    w.rotation.x = Math.PI / 2;
    w.position.set(x, 0.3, z);
    p.push(w);
  }
  const fx = variant === 1 ? 1.96 : 2.01;
  bx(p, 0.06, 0.14, 0.34, 0xfff3c4, fx, 0.78, 0.55);
  bx(p, 0.06, 0.14, 0.34, 0xfff3c4, fx, 0.78, -0.55);
  bx(p, 0.06, 0.13, 0.34, 0xd6453d, -fx, 0.8, 0.58);
  bx(p, 0.06, 0.13, 0.34, 0xd6453d, -fx, 0.8, -0.58);
  bx(p, 0.12, 0.18, 1.7, 0x3a3d42, fx + 0.02, 0.44, 0);
  bx(p, 0.12, 0.18, 1.7, 0x3a3d42, -fx - 0.02, 0.44, 0);
  bx(p, 0.04, 0.16, 0.9, 0x3a3d42, fx + 0.01, 0.58, 0);
}

/** 公交车：车身沿 x，车头在 +x */
export function bus(p: Parts, color: number) {
  bx(p, 8.6, 1.7, 2.3, color, 0, 1.3, 0);
  bx(p, 7.4, 0.78, 2.34, 0x2f3b4a, -0.3, 1.72, 0);
  bx(p, 8.2, 0.12, 2.2, 0xf1efe8, 0, 2.2, 0);
  bx(p, 0.06, 0.95, 1.95, 0x2f3b4a, 4.31, 1.7, 0);
  bx(p, 0.06, 0.7, 1.7, 0x2f3b4a, -4.31, 1.75, 0);
  bx(p, 1.1, 0.06, 0.3, 0xf2d998, 3.9, 2.3, 0);
  for (const [x, z] of [[2.9, 1.05], [2.9, -1.05], [-2.9, 1.05], [-2.9, -1.05]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.28, 12), M(0x1e2126));
    w.rotation.x = Math.PI / 2;
    w.position.set(x, 0.44, z);
    p.push(w);
  }
  bx(p, 0.06, 0.18, 0.4, 0xfff3c4, 4.31, 0.8, 0.75);
  bx(p, 0.06, 0.18, 0.4, 0xfff3c4, 4.31, 0.8, -0.75);
  bx(p, 0.06, 0.16, 0.3, 0xd6453d, -4.31, 0.85, 0.85);
  bx(p, 0.06, 0.16, 0.3, 0xd6453d, -4.31, 0.85, -0.85);
  bx(p, 0.5, 0.1, 2.32, 0x3a3d42, 4.36, 0.5, 0);
  bx(p, 0.5, 0.1, 2.32, 0x3a3d42, -4.36, 0.5, 0);
}

// ---------- 广场 / 公园 ----------

export function fountain(k: Kit) {
  const p = k.solid;
  cy(p, 4.3, 4.4, 0.55, STONE, 0, 0.275, 0, 28);
  cy(p, 3.9, 3.9, 0.5, 0x86cfe6, 0, 0.3, 0, 28);
  cy(k.glow("water"), 3.85, 3.85, 0.03, 0x9fdcee, 0, 0.57, 0, 28); // 水面：不受光，保持透亮
  cy(p, 0.95, 1.05, 0.95, STONE, 0, 0.75, 0, 14);
  cy(p, 0.22, 0.26, 1.5, STONE, 0, 1.9, 0, 10);
  cy(p, 1.25, 0.45, 0.32, STONE, 0, 2.72, 0, 14);
  cy(k.glow("water"), 1.1, 1.1, 0.06, 0x9fdcee, 0, 2.9, 0, 14);
  cn(k.glow("water"), 0.42, 2.4, 0xd8f1fa, 0, 4.2, 0, 8);
}

export function parasolTable(k: Kit, color: number) {
  const p = k.solid;
  cy(p, 0.04, 0.04, 2.2, IRON, 0, 1.1, 0, 6);
  cn(p, 1.35, 0.5, color, 0, 2.35, 0, 8);
  cy(p, 0.6, 0.6, 0.05, 0xf1efe8, 0, 0.76, 0, 12);
  cy(p, 0.05, 0.16, 0.74, IRON, 0, 0.38, 0, 6);
  for (const s of [-1, 1]) {
    bx(p, 0.42, 0.05, 0.42, WOOD, s * 0.95, 0.45, 0);
    bx(p, 0.42, 0.45, 0.05, WOOD, s * 0.95, 0.7, s * 0.2);
    bx(p, 0.05, 0.44, 0.36, IRON, s * 0.95, 0.22, 0);
  }
}

/** 售货亭：正面（+z）是柜台 */
export function kiosk(k: Kit) {
  const p = k.solid;
  bx(p, 3.6, 0.95, 2.3, 0xe9dcc3, 0, 0.48, -0.1);
  bx(p, 3.9, 0.09, 2.6, 0xc9806a, 0, 0.99, -0.1);
  for (const [x, z] of [[-1.7, 0.95], [1.7, 0.95], [-1.7, -1.1], [1.7, -1.1]]) bx(p, 0.1, 2.3, 0.1, 0x8a6a48, x, 2.1, z);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.0, 1.2, 4), M(0xc65f76));
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(1.18, 1, 0.86);
  roof.position.set(0, 3.85, -0.08);
  p.push(roof);
  bx(p, 3.3, 1.25, 0.08, 0xd9cfba, 0, 1.68, -1.05);
  bx(p, 3.4, 0.42, 0.08, 0x3a6ea8, 0, 2.78, 0.98);
  const goods = [0xe8604a, 0xf2b64e, 0x7bb98a, 0x53a8e0];
  goods.forEach((c, i) => {
    bx(p, 0.55, 0.22, 0.42, 0xd8d2c4, -1.2 + i * 0.8, 1.14, 0.5);
    sp(p, 0.1, c, -1.38 + i * 0.8, 1.3, 0.5, 1, 6);
    sp(p, 0.1, c, -1.08 + i * 0.8, 1.3, 0.46, 1, 6);
    sp(p, 0.1, c, -1.22 + i * 0.8, 1.32, 0.6, 1, 6);
  });
}

export function clockTower(p: Parts) {
  bx(p, 2.0, 0.35, 2.0, STONE, 0, 0.175, 0);
  bx(p, 1.5, 4.6, 1.5, 0xe9dcc3, 0, 2.65, 0);
  bx(p, 1.66, 0.16, 1.66, 0xc9806a, 0, 5.0, 0);
  bx(p, 1.2, 1.0, 1.2, 0x3a6ea8, 0, 5.6, 0);
  for (const [x, z, ry] of [[0, 0.61, 0], [0, -0.61, 0], [0.61, 0, Math.PI / 2], [-0.61, 0, Math.PI / 2]]) {
    const face = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.04, 18), M(0xf7f4ea));
    face.rotation.x = Math.PI / 2;
    face.rotation.z = ry;
    face.position.set(x, 5.6, z);
    p.push(face);
  }
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.15, 1.3, 4), M(0xc65f76));
  roof.rotation.y = Math.PI / 4;
  roof.position.set(0, 6.75, 0);
  p.push(roof);
  sp(p, 0.1, 0xe8c45a, 0, 7.5, 0, 1, 6);
}

export function pergola(p: Parts) {
  for (const [x, z] of [[-2.2, -1.1], [2.2, -1.1], [-2.2, 1.1], [2.2, 1.1]]) bx(p, 0.14, 2.5, 0.14, 0x8a6a48, x, 1.25, z);
  bx(p, 5.0, 0.12, 0.14, 0x8a6a48, 0, 2.55, -1.1);
  bx(p, 5.0, 0.12, 0.14, 0x8a6a48, 0, 2.55, 1.1);
  for (let x = -2.3; x <= 2.3; x += 0.46) bx(p, 0.07, 0.06, 2.6, 0xc99a62, x, 2.66, 0);
  bench(p);
  for (const m of p.slice(-BENCH_PARTS)) m.position.z -= 0.6;
}

export function flowerBed(p: Parts, tone = 0) {
  bx(p, 2.6, 0.3, 1.3, STONE, 0, 0.15, 0);
  bx(p, 2.4, 0.06, 1.1, 0x4a3a2c, 0, 0.32, 0);
  const cols = [0xe8604a, 0xf2b64e, 0xf07a9a, 0xf4f1ea, 0xc97ad8];
  for (let i = 0; i < 12; i++) {
    const x = -1.05 + (i % 6) * 0.42;
    const z = i < 6 ? -0.25 : 0.25;
    sp(p, 0.16, LEAF[(i + tone) % 3], x, 0.4, z, 0.8, 6);
    sp(p, 0.1, cols[(i + tone) % 5], x, 0.56, z, 1, 6);
  }
}

export function hedge(p: Parts, len: number) {
  bx(p, 0.55, 0.55, len, 0x3f7d4a, 0, 0.28, 0);
  const n = Math.max(2, Math.round(len / 0.7));
  for (let i = 0; i < n; i++) sp(p, 0.3, 0x4c8f57, (i % 2 ? 0.08 : -0.08), 0.56, -len / 2 + 0.35 + i * ((len - 0.7) / Math.max(1, n - 1)), 0.9, 6);
}

/** 园灯：灯罩走 glow("lamp") */
export function parkLamp(k: Kit) {
  const p = k.solid;
  cy(p, 0.13, 0.16, 0.16, 0x6f6a60, 0, 0.08, 0);
  cy(p, 0.045, 0.065, 3.0, IRON, 0, 1.6, 0, 6);
  cy(p, 0.16, 0.09, 0.1, IRON, 0, 3.12, 0, 8);
  sp(k.glow("lamp"), 0.19, 0xfff1c9, 0, 2.98, 0, 1, 8);
}

/** 池塘：椭圆水面（sx/sz 为半径）+ 石岸 + 睡莲叶 */
export function pond(p: Parts, sx: number, sz: number) {
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.03, 0.22, 26), M(STONE));
  rim.scale.set(sx + 0.45, 1, sz + 0.45);
  rim.position.set(0, 0.1, 0);
  p.push(rim);
  const water = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.2, 26), M(0x7cc9e2));
  water.scale.set(sx, 1, sz);
  water.position.set(0, 0.13, 0);
  p.push(water);
  const cols = [[-0.4, 0.2], [0.3, -0.3], [0.5, 0.35], [-0.1, -0.45]];
  cols.forEach(([x, z], i) => {
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.03, 9), M(0x5aa864));
    pad.position.set(x * sx, 0.25, z * sz);
    p.push(pad);
    if (i % 2 === 0) sp(p, 0.11, 0xf7bcd2, x * sx, 0.33, z * sz, 0.9, 6);
  });
}

/** 儿童游乐场：秋千 + 滑梯 + 沙坑 */
export function playground(k: Kit) {
  const p = k.solid;
  // 秋千架
  for (const x of [-1.6, 1.6]) {
    bx(p, 0.09, 2.3, 0.09, 0xe8c45a, x, 1.05, -0.55, 0);
    p[p.length - 1].rotation.x = -0.42;
    bx(p, 0.09, 2.3, 0.09, 0xe8c45a, x, 1.05, 0.55, 0);
    p[p.length - 1].rotation.x = 0.42;
  }
  bx(p, 3.5, 0.1, 0.1, 0xe8c45a, 0, 2.12, 0);
  for (const x of [-0.75, 0.75]) {
    bx(p, 0.03, 1.35, 0.03, 0x555b62, x - 0.2, 1.42, 0);
    bx(p, 0.03, 1.35, 0.03, 0x555b62, x + 0.2, 1.42, 0);
    bx(p, 0.5, 0.06, 0.28, 0x3a6ea8, x, 0.74, 0);
  }
  // 滑梯
  for (const [x, z] of [[4.2, -0.6], [5.4, -0.6], [4.2, 0.6], [5.4, 0.6]]) bx(p, 0.1, 1.7, 0.1, 0xe8604a, x, 0.85, z);
  bx(p, 1.5, 0.1, 1.5, 0xf2b64e, 4.8, 1.72, 0);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.35, 0.8, 4), M(0x3a6ea8));
  roof.rotation.y = Math.PI / 4;
  roof.position.set(4.8, 2.55, 0);
  p.push(roof);
  for (const [x, z] of [[4.1, -0.6], [5.5, -0.6], [4.1, 0.6], [5.5, 0.6]]) bx(p, 0.07, 0.85, 0.07, 0x3a6ea8, x, 2.15, z);
  for (let i = 0; i < 4; i++) bx(p, 0.5, 0.05, 0.05, 0x555b62, 4.8, 0.35 + i * 0.4, -0.78);
  const chute = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.08, 0.7), M(0xd8dde2));
  chute.position.set(6.2, 0.95, 0);
  chute.rotation.z = -0.5;
  p.push(chute);
  bx(p, 2.9, 0.16, 0.06, 0xe8604a, 6.2, 1.05, 0.37).rotation.z = -0.5;
  bx(p, 2.9, 0.16, 0.06, 0xe8604a, 6.2, 1.05, -0.37).rotation.z = -0.5;
  // 沙坑
  bx(p, 3.2, 0.22, 0.12, WOOD, -0.2, 0.11, -1.5);
  bx(p, 3.2, 0.22, 0.12, WOOD, -0.2, 0.11, -2.9);
  bx(p, 0.12, 0.22, 1.5, WOOD, -1.8, 0.11, -2.2);
  bx(p, 0.12, 0.22, 1.5, WOOD, 1.4, 0.11, -2.2);
  bx(p, 3.1, 0.08, 1.3, 0xecd9a6, -0.2, 0.1, -2.2);
  sp(p, 0.28, 0xecd9a6, -0.6, 0.2, -2.2, 0.6, 7);
  cy(p, 0.14, 0.1, 0.16, 0xd6453d, 0.5, 0.2, -2.0, 8);
}

/** 野餐桌 */
export function picnicTable(p: Parts) {
  bx(p, 1.9, 0.08, 0.8, WOOD, 0, 0.72, 0);
  bx(p, 1.9, 0.06, 0.3, WOOD, 0, 0.45, 0.72);
  bx(p, 1.9, 0.06, 0.3, WOOD, 0, 0.45, -0.72);
  for (const x of [-0.75, 0.75]) {
    bx(p, 0.09, 0.95, 0.09, IRON, x, 0.38, 0.45).rotation.x = -0.75;
    bx(p, 0.09, 0.95, 0.09, IRON, x, 0.38, -0.45).rotation.x = 0.75;
  }
}
