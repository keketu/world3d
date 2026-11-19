// 程序化低模道具生成器：树/花丛/小屋/围栏/小路/池塘（office3d 审美）
// 每件道具合并为单 Mesh（顶点色）= 1 draw call；顶点焊接 → 圆润平滑着色
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { WorldObject } from "@world3d/shared";

const matCache = new Map<string, THREE.MeshLambertMaterial>();
function mat(color: string): THREE.MeshLambertMaterial {
  let m = matCache.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color });
    matCache.set(color, m);
  }
  return m;
}

function sphere(r: number, color: string, x = 0, y = 0, z = 0, sy = 1): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 16), mat(color));
  m.position.set(x, y, z);
  m.scale.y = sy;
  return m;
}

function cone(r: number, h: number, color: string, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 14), mat(color));
  m.position.set(x, y, z);
  return m;
}

function cyl(r1: number, r2: number, h: number, color: string, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, 12), mat(color));
  m.position.set(x, y, z);
  return m;
}

function box(w: number, h: number, d: number, color: string, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  return m;
}

/** 把 group 展开为非索引三角形并写入顶点色，合并为单 geometry */
function paintAndMerge(group: THREE.Group): THREE.BufferGeometry {
  group.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  group.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) meshes.push(child as THREE.Mesh);
  });
  const pos: number[] = [];
  const col: number[] = [];
  for (const m of meshes) {
    const g = (m.geometry as THREE.BufferGeometry).clone();
    g.applyMatrix4(m.matrixWorld);
    const c = new THREE.Color((m.material as THREE.MeshLambertMaterial).color);
    // 关键：索引几何必须按 index 展开为三角形序列；单纯 setIndex(null) 会导致面片错乱
    const idxAttr = g.getIndex();
    const pa = g.getAttribute("position");
    if (idxAttr) {
      for (let i = 0; i < idxAttr.count; i++) {
        const vi = idxAttr.getX(i);
        pos.push(pa.getX(vi), pa.getY(vi), pa.getZ(vi));
        col.push(c.r, c.g, c.b);
      }
    } else {
      const count = pa.count;
      for (let i = 0; i < count; i++) {
        pos.push(pa.getX(i), pa.getY(i), pa.getZ(i));
        col.push(c.r, c.g, c.b);
      }
    }
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  merged.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  // 顶点焊接：同一部件内重合顶点合并 → computeVertexNormals 得到平滑法线（圆润，无碎面）
  const welded = mergeVertices(merged, 1e-4);
  welded.computeVertexNormals();
  group.clear();
  return welded;
}

function buildTree(variant: string, g: THREE.Group) {
  if (variant === "樱花") {
    g.add(cyl(0.16, 0.26, 2.6, "#8a5b45", 0, 1.3, 0));
    g.add(sphere(1.15, "#f5aec6", 0, 3.1, 0, 1.25));
    g.add(sphere(0.8, "#f19cc0", 0.75, 2.6, 0.35));
    g.add(sphere(0.65, "#f7bcd2", -0.65, 2.8, -0.45));
    g.add(sphere(0.6, "#f5aec6", 0.15, 3.9, -0.25));
  } else if (variant === "松") {
    g.add(cyl(0.14, 0.2, 1.1, "#6b4a2f", 0, 0.55, 0));
    g.add(cone(1.5, 1.8, "#3a7550", 0, 1.7, 0));
    g.add(cone(1.15, 1.5, "#45855c", 0, 2.6, 0));
    g.add(cone(0.8, 1.2, "#3a7550", 0, 3.4, 0));
  } else if (variant === "白桦") {
    g.add(cyl(0.13, 0.18, 2.4, "#e3ddd0", 0, 1.2, 0));
    g.add(sphere(1.05, "#8cc06a", 0, 3.0, 0, 1.15));
  } else {
    g.add(cyl(0.18, 0.26, 1.7, "#7d5b3d", 0, 0.85, 0));
    g.add(sphere(1.4, "#5da45e", 0, 2.7, 0));
    g.add(sphere(0.8, "#6bb46a", 0.7, 2.2, 0.4));
  }
}

function buildFlowerBed(variant: string, g: THREE.Group) {
  const colors: Record<string, string> = { 红: "#d65050", 黄: "#e8c852", 粉: "#eb98ba", 白: "#f0f0eb" };
  const petal = colors[variant] ?? "#eb98ba";
  const leaf = "#5da45e";
  const rnd = (i: number) => ((Math.sin(i * 127.1) + 1) / 2 - 0.5) * 1.6;
  for (let i = 0; i < 6; i++) {
    const x = rnd(i * 3 + 1);
    const z = rnd(i * 5 + 2);
    g.add(cyl(0.03, 0.03, 0.4, leaf, x, 0.2, z));
    g.add(sphere(0.13, petal, x, 0.46, z));
    g.add(sphere(0.07, leaf, x + 0.12, 0.16, z + 0.08));
  }
}

function buildHouse(variant: string, params: Record<string, unknown>, g: THREE.Group) {
  const w = Math.min(11, Math.max(3, Number(params?.w ?? 5)));
  const d = Math.min(11, Math.max(3, Number(params?.d ?? 5)));
  const wallColor = variant === "石屋" ? "#c9c9cf" : "#f7ead2";
  const roofColor = variant === "石屋" ? "#8a92a3" : "#e2907e";
  const H = 2.2;
  g.add(box(w, H, d, wallColor, 0, H / 2, 0));
  const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.78, 1.5, 4), mat(roofColor));
  roof.position.y = H + 0.75;
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(d / Math.max(w, d), 1, w / Math.max(w, d));
  g.add(roof);
  g.add(box(0.9, 1.5, 0.1, "#7d5b3d", 0, 0.75, d / 2 + 0.03));
  g.add(box(0.7, 0.6, 0.06, "#bcd8f5", -w / 4, 1.3, d / 2 + 0.03));
  g.add(box(0.7, 0.6, 0.06, "#bcd8f5", w / 4, 1.3, d / 2 + 0.03));
  g.add(box(0.4, 0.9, 0.4, variant === "石屋" ? "#9a9aa3" : "#c9a06a", w / 3, H + 1.2, -d / 4));
}

function buildFence(params: Record<string, unknown>, g: THREE.Group) {
  const len = Math.min(30, Math.max(4, Number(params?.len ?? 7)));
  const half = len / 2;
  const n = Math.ceil(len / 2);
  for (let i = 0; i <= n; i++) {
    const off = -half + (i * len) / n;
    g.add(box(0.16, 0.9, 0.16, "#9a7345", off, 0.45, -half));
    g.add(box(0.16, 0.9, 0.16, "#9a7345", off, 0.45, half));
    g.add(box(0.16, 0.9, 0.16, "#9a7345", -half, 0.45, off));
    g.add(box(0.16, 0.9, 0.16, "#9a7345", half, 0.45, off));
  }
  const railColor = "#b98d5e";
  g.add(box(len, 0.08, 0.07, railColor, 0, 0.62, -half));
  g.add(box(len, 0.08, 0.07, railColor, 0, 0.32, -half));
  g.add(box(len, 0.08, 0.07, railColor, 0, 0.62, half));
  g.add(box(len, 0.08, 0.07, railColor, 0, 0.32, half));
  g.add(box(0.07, 0.08, len, railColor, -half, 0.62, 0));
  g.add(box(0.07, 0.08, len, railColor, -half, 0.32, 0));
  g.add(box(0.07, 0.08, len, railColor, half, 0.62, 0));
  g.add(box(0.07, 0.08, len, railColor, half, 0.32, 0));
}

function buildPath(variant: string, params: Record<string, unknown>, g: THREE.Group) {
  const len = Math.min(40, Math.max(3, Number(params?.len ?? 8)));
  const dx = Number(params?.dx ?? 0);
  const dz = Number(params?.dz ?? 1);
  const color = variant === "木板路" ? "#c9a06a" : "#b0a89a";
  for (let i = 0; i < len; i++) {
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.12, 14), mat(color));
    disc.position.set(dx * i + Math.sin(i * 3.7) * 0.2, 0.02, dz * i + Math.cos(i * 2.9) * 0.2);
    g.add(disc);
  }
}

function buildPond(params: Record<string, unknown>, g: THREE.Group) {
  const r = Math.min(9, Math.max(2, Number(params?.r ?? 4)));
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(r * 0.92, 32),
    new THREE.MeshLambertMaterial({ color: "#7ec4e8", transparent: true, opacity: 0.72 })
  );
  water.rotation.x = -Math.PI / 2;
  g.add(water);
  const rim = new THREE.Mesh(new THREE.RingGeometry(r * 0.92, r * 1.12, 26), mat("#e7d491"));
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.06;
  g.add(rim);
}

export interface PropMeshResult {
  mesh: THREE.Mesh;
  /** 标注浮签高度 */
  labelY: number;
  /** 池塘水面的世界 y 偏移（相对地面） */
  waterOffset?: number;
}

/** 生成一件道具的合并网格（1 draw call） */
export function buildProp(o: WorldObject): PropMeshResult {
  const g = new THREE.Group();
  let labelY = 3;
  let waterOffset: number | undefined;
  switch (o.kind) {
    case "tree":
      buildTree(o.variant, g);
      labelY = 3.6;
      break;
    case "flower":
      buildFlowerBed(o.variant, g);
      labelY = 1.1;
      break;
    case "house":
      buildHouse(o.variant, o.params ?? {}, g);
      labelY = 4.4;
      break;
    case "fence":
      buildFence(o.params ?? {}, g);
      labelY = 1.6;
      break;
    case "path":
      buildPath(o.variant, o.params ?? {}, g);
      labelY = 0.8;
      break;
    case "pond": {
      buildPond(o.params ?? {}, g);
      const depth = Math.min(3.2, Number(o.params?.depth ?? 3));
      // 池塘水盘放到凹陷底部（相对地面往下）
      g.position.y = -depth + 0.7;
      waterOffset = -depth + 0.7;
      labelY = 1.2;
      break;
    }
  }
  const geo = paintAndMerge(g);
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.userData.labelY = labelY;
  mesh.userData.waterOffset = waterOffset;
  return { mesh, labelY, waterOffset };
}
