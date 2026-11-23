// 程序化低模道具生成器：树/花丛/小屋/围栏/小路/池塘（office3d 审美）
// 每件道具合并为单 Mesh（顶点色）= 1 draw call；顶点焊接 → 圆润平滑着色
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { textTexture } from "../konbini/build";
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

function cyl(r1: number, r2: number, h: number, color: string, x = 0, y = 0, z = 0, rotZ = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, 12), mat(color));
  m.position.set(x, y, z);
  if (rotZ) m.rotation.z = rotZ;
  return m;
}

function box(w: number, h: number, d: number, color: string, x = 0, y = 0, z = 0, rotY = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  if (rotY) m.rotation.y = rotY;
  return m;
}

/** 把 group 展开为非索引三角形并写入顶点色，合并为单 geometry（房间/楼宇等大型静态物复用） */
export function paintAndMerge(group: THREE.Group): THREE.BufferGeometry {
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
    // 樱花：锥度树干 + 斜枝 + 三团花簇（粉白渐变）+ 散落花瓣
    g.add(cyl(0.13, 0.2, 1.9, "#7a5240", 0, 0.95, 0));
    g.add(cyl(0.07, 0.11, 0.9, "#7a5240", 0.28, 1.5, 0, 0.5));
    g.add(sphere(0.95, "#f5aec6", 0, 2.5, 0, 1.15));
    g.add(sphere(0.62, "#f7bcd2", 0.55, 2.15, 0.3));
    g.add(sphere(0.55, "#f19cc0", -0.5, 2.3, -0.35));
    g.add(sphere(0.5, "#fad4e2", 0.1, 3.25, -0.15));
    g.add(sphere(0.34, "#fad4e2", -0.35, 2.9, 0.3));
    g.add(sphere(0.09, "#f5aec6", 0.9, 0.35, 0.5));
    g.add(sphere(0.08, "#f5aec6", -0.7, 0.28, -0.4));
  } else if (variant === "松") {
    // 松：可见树干 + 三层锥冠（越上越窄越深）+ 顶芽
    g.add(cyl(0.12, 0.18, 0.9, "#6b4a2f", 0, 0.45, 0));
    g.add(cone(1.35, 1.1, "#3a7550", 0, 1.35, 0));
    g.add(cone(1.05, 1.0, "#45855c", 0, 2.05, 0));
    g.add(cone(0.72, 0.9, "#3a7550", 0, 2.75, 0));
    g.add(cone(0.16, 0.5, "#2c5e40", 0, 3.35, 0));
  } else if (variant === "白桦") {
    // 白桦：白干黑环纹 + 双团亮冠
    g.add(cyl(0.1, 0.15, 2.2, "#e3ddd0", 0, 1.1, 0));
    g.add(cyl(0.155, 0.155, 0.05, "#3a352e", 0, 0.5, 0));
    g.add(cyl(0.14, 0.14, 0.05, "#3a352e", 0, 1.0, 0));
    g.add(cyl(0.125, 0.125, 0.05, "#3a352e", 0, 1.5, 0));
    g.add(sphere(0.95, "#8cc06a", 0, 2.6, 0, 1.1));
    g.add(sphere(0.5, "#a5cf7e", 0.45, 2.15, 0.3));
    g.add(sphere(0.42, "#7cb35e", -0.4, 2.3, -0.3));
  } else {
    // 橡树：粗干 + 大冠 + 内层暗球
    g.add(cyl(0.16, 0.24, 1.5, "#7d5b3d", 0, 0.75, 0));
    g.add(cyl(0.09, 0.13, 0.8, "#7d5b3d", 0.32, 1.3, 0, 0.6));
    g.add(sphere(1.3, "#5da45e", 0, 2.45, 0, 1.1));
    g.add(sphere(0.72, "#4e9450", -0.5, 1.95, -0.3));
    g.add(sphere(0.62, "#6bb46a", 0.55, 2.1, 0.4));
    g.add(sphere(0.45, "#6bb46a", 0.1, 3.0, -0.2));
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
  const stone = variant === "石屋";
  const wallColor = stone ? "#c9c9cf" : "#f7ead2";
  const roofColor = stone ? "#8a92a3" : "#e2907e";
  const beam = stone ? "#8f96a3" : "#8a6a48"; // 半木结构深色木架（石屋用石框）
  const H = 2.2;
  g.add(box(w, H, d, wallColor, 0, H / 2, 0));

  // 半木结构：横梁（顶/中）+ 竖柱（前后左右立面）
  const beams = (axis: "x" | "z") => {
    if (axis === "x") {
      for (const zz of [-d / 2 - 0.03, d / 2 + 0.03]) {
        g.add(box(w + 0.06, 0.09, 0.06, beam, 0, H - 0.35, zz));
        g.add(box(w + 0.06, 0.09, 0.06, beam, 0, 0.5, zz));
      }
      for (const xx of [-w / 2 + w * 0.25, w * 0.0, w / 2 - w * 0.25]) {
        g.add(box(0.09, H, 0.06, beam, xx, H / 2, -d / 2 - 0.03));
        g.add(box(0.09, H, 0.06, beam, xx, H / 2, d / 2 + 0.03));
      }
    } else {
      for (const xx of [-w / 2 - 0.03, w / 2 + 0.03]) {
        g.add(box(0.06, 0.09, d + 0.06, beam, xx, H - 0.35, 0));
        g.add(box(0.06, 0.09, d + 0.06, beam, xx, 0.5, 0));
      }
      for (const zz of [-d / 2 + d * 0.3, d * 0.0, -d * 0.3]) {
        g.add(box(0.06, H, 0.09, beam, -w / 2 - 0.03, H / 2, zz));
        g.add(box(0.06, H, 0.09, beam, w / 2 + 0.03, H / 2, zz));
      }
    }
  };
  beams("x");
  beams("z");

  // 四坡屋顶（上下双锥叠出瓦檐）+ 屋脊
  const roofH = 1.5;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.82, roofH, 4), mat(roofColor));
  roof.position.y = H + roofH / 2;
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(d / Math.max(w, d), 1, w / Math.max(w, d));
  g.add(roof);
  const ridgeLen = Math.max(w, d) * 0.55;
  g.add(box(ridgeLen, 0.14, 0.3, stone ? "#6f7684" : "#c96a5a", 0, H + roofH - 0.28, 0, Math.PI / 4));

  // 烟囱（+烟灰缸口）
  g.add(box(0.4, 1.2, 0.4, stone ? "#9a9aa3" : "#c9a06a", w / 3, H + roofH + 0.2, -d / 4));
  g.add(box(0.48, 0.14, 0.48, stone ? "#6f7684" : "#8a6a48", w / 3, H + roofH + 0.82, -d / 4));

  // 门（+z 面）：门框 + 门板 + 台阶
  g.add(box(1.1, 1.9, 0.08, beam, 0, 0.95, d / 2 + 0.04));
  g.add(box(0.9, 1.7, 0.06, "#a8805a", 0, 0.92, d / 2 + 0.09));
  g.add(sphere(0.05, "#e8c45a", 0.3, 0.95, d / 2 + 0.13));
  g.add(box(1.3, 0.12, 0.5, stone ? "#9a9aa3" : "#c9a06a", 0, 0.06, d / 2 + 0.2));

  // 窗 ×2（+z 面）：窗框 + 玻璃 + 窗台
  for (const xx of [-w / 4, w / 4]) {
    g.add(box(0.8, 0.7, 0.07, beam, xx, 1.35, d / 2 + 0.04));
    g.add(box(0.66, 0.56, 0.05, "#bcd8f5", xx, 1.35, d / 2 + 0.08));
    g.add(box(0.86, 0.09, 0.16, stone ? "#9a9aa3" : "#c9a06a", xx, 0.96, d / 2 + 0.06));
  }
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

/** 办公楼外观（系统建筑）：两层小楼 + 玻璃窗 + 门 + 樱花粉招牌，门朝 +z */
function buildOfficeBuilding(g: THREE.Group) {
  // 主体两层
  g.add(box(8, 2.7, 6, "#f2ead9", 0, 1.35, 0));
  g.add(box(7, 2.3, 5, "#ead9bd", 0, 2.7 + 1.15, -0.3));
  g.add(box(7.8, 0.3, 5.8, "#d9cdb4", 0, 5.2, -0.3)); // 屋顶板
  g.add(box(7.2, 0.5, 5.2, "#c9b896", 0, 2.7, -0.3)); // 层间檐口
  // 一层前窗 ×3（发光）
  for (const wx of [-2.4, 0, 2.4]) {
    g.add(box(1.5, 1.0, 0.1, "#cfe8f2", wx, 1.7, 3.02));
    g.add(box(1.6, 1.1, 0.06, "#8a7c62", wx, 1.7, 3.0));
  }
  // 二层窗 ×3（发光）
  for (const wx of [-2.0, 0, 2.0]) {
    g.add(box(1.3, 0.9, 0.1, "#cfe8f2", wx, 3.85, 2.27));
    g.add(box(1.4, 1.0, 0.06, "#8a7c62", wx, 3.85, 2.25));
  }
  // 门 + 门垫（前立面 +z，门垫在 doorDist 处）
  g.add(box(1.3, 2.1, 0.16, "#a8805a", 0, 1.05, 3.04));
  g.add(box(0.16, 2.2, 0.2, "#8a6a48", -0.75, 1.1, 3.05));
  g.add(box(0.16, 2.2, 0.2, "#8a6a48", 0.75, 1.1, 3.05));
  g.add(box(2.0, 0.05, 1.3, "#c65f76", 0, 0.03, 4.6));
  // 雨棚
  g.add(box(2.6, 0.14, 1.0, "#8a6a48", 0, 2.45, 3.4));
  // 招牌（樱花粉底 + 白色圆点与横条 = 抽象 logo，不写字保字号清晰）
  g.add(box(3.6, 0.75, 0.14, "#c65f76", 0, 3.15, 3.2));
  g.add(sphere(0.17, "#fdf9f7", -1.25, 3.15, 3.29));
  g.add(box(1.7, 0.16, 0.05, "#fdf9f7", 0.35, 3.15, 3.29));
}

/** 写字楼（阳光都市）：裙房 + 分层窗带 + 屋顶天线，门朝 +z */
function buildTower(variant: string, params: Record<string, unknown>, g: THREE.Group) {
  const w = Math.min(10, Math.max(6, Number(params?.w ?? 7)));
  const d = Math.min(10, Math.max(6, Number(params?.d ?? 7)));
  const floors = Math.min(12, Math.max(4, Number(params?.f ?? 6)));
  const FH = 3; // 每层高
  // 配色：主体 / 窗带玻璃 / 裙房 / 屋顶饰
  const P =
    variant === "暖白"
      ? { body: "#f4ede0", glass: "#8fb6c9", podium: "#e8dfcd", trim: "#e2907e" }
      : variant === "陶土红"
        ? { body: "#c67a5f", glass: "#d8e4ea", podium: "#e6cdb4", trim: "#f2e3cd" }
        : { body: "#eef1ea", glass: "#4d7fa8", podium: "#dfe4de", trim: "#f2f1ec" };

  const podiumH = 2.8;
  // 裙房（大半圈玻璃廊）
  g.add(box(w + 1.6, podiumH, d + 1.6, P.podium, 0, podiumH / 2, 0));
  g.add(box(w + 1.7, 1.3, d + 1.7, P.glass, 0, 1.05, 0)); // 裙房玻璃带
  // 裙房竖向分隔（玻璃幕墙的竖框）
  for (let i = 0; i < 6; i++) {
    const bx2 = -w / 2 + ((i + 0.5) * (w + 1.6)) / 6;
    g.add(box(0.12, 1.3, d + 1.75, P.trim, bx2, 1.05, 0));
  }
  // 塔身
  const bodyH = floors * FH;
  const bodyY0 = podiumH;
  g.add(box(w, bodyH, d, P.body, 0, bodyY0 + bodyH / 2, 0));
  // 每层窗带（环绕式薄盒，微微出挑）+ 竖框
  for (let i = 0; i < floors; i++) {
    g.add(box(w + 0.14, 1.5, d + 0.14, P.glass, 0, bodyY0 + i * FH + FH * 0.62, 0));
    const cols = Math.max(3, Math.round(w / 1.6));
    for (let c = 0; c < cols; c++) {
      const px2 = -w / 2 + ((c + 0.5) * w) / cols;
      g.add(box(0.1, 1.55, d + 0.18, P.body, px2, bodyY0 + i * FH + FH * 0.62, 0));
    }
  }
  // 每两层一个阳台（带栏杆）
  for (let i = 1; i < floors; i += 2) {
    const ay = bodyY0 + i * FH - 0.1;
    g.add(box(w * 0.42, 0.12, 0.9, P.trim, 0, ay, d / 2 + 0.4));
    g.add(box(w * 0.42, 0.06, 0.06, P.trim, 0, ay + 0.55, d / 2 + 0.82));
    for (let c = 0; c < 5; c++) {
      g.add(box(0.05, 0.55, 0.05, P.trim, -w * 0.19 + (c * w * 0.38) / 4, ay + 0.28, d / 2 + 0.82));
    }
  }
  // 屋顶：女儿墙 + 空调机组 + 天线
  const top = bodyY0 + bodyH;
  g.add(box(w + 0.4, 0.5, d + 0.4, P.trim, 0, top + 0.25, 0));
  g.add(box(w * 0.3, 0.6, d * 0.3, "#c9c4ba", -w * 0.2, top + 0.7, -d * 0.15));
  g.add(box(w * 0.22, 0.5, d * 0.24, "#b5afa4", w * 0.22, top + 0.65, d * 0.18));
  g.add(cyl(0.08, 0.08, 2.4, "#9aa2a8", -w * 0.28, top + 1.7, d * 0.2));
  g.add(sphere(0.16, "#e2907e", -w * 0.28, top + 3.0, d * 0.2));
  // 入口（局部 +z 面）：玻璃门 + 雨棚 + 门垫
  g.add(box(2.2, 2.3, 0.14, P.glass, 0, 1.35, (d + 1.6) / 2 + 0.02));
  g.add(box(0.14, 2.3, 0.16, P.podium, -1.15, 1.35, (d + 1.6) / 2 + 0.02));
  g.add(box(0.14, 2.3, 0.16, P.podium, 1.15, 1.35, (d + 1.6) / 2 + 0.02));
  g.add(box(3.0, 0.18, 1.5, P.trim, 0, podiumH + 0.5, (d + 1.6) / 2 + 0.75));
  g.add(box(2.4, 0.05, 1.3, "#c65f76", 0, 0.03, (d + 1.6) / 2 + 1.6));
  // 楼顶公司招牌（白底蓝字，远看也读得出）
  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(Math.min(w * 0.7, 5), 1.1, 0.16),
    new THREE.MeshBasicMaterial({
      map: textTexture(variant === "暖白" ? "小世界" : variant === "陶土红" ? "CITY" : "OFFICE", {
        bg: "#f4f2ec", fg: "#1e3a5f", border: "#1e3a5f", w: 384, h: 96, font: 52,
      }),
    })
  );
  sign.position.set(0, top + 1.0, d / 2 + 0.16);
  g.add(sign);
  g.add(box(Math.min(w * 0.7, 5) + 0.14, 1.24, 0.1, P.trim, 0, top + 1.0, d / 2 + 0.08));
}

/** 商铺（阳光都市）：两层彩色小楼 + 橱窗 + 条纹雨棚 + 屋顶招牌，门朝 +z */
function buildShop(variant: string, params: Record<string, unknown>, g: THREE.Group) {
  const w = Math.min(8, Math.max(5, Number(params?.w ?? 6)));
  const d = Math.min(8, Math.max(5, Number(params?.d ?? 6)));
  const P =
    variant === "薄荷绿"
      ? { body: "#9ec9b4", trim: "#2f5d4d", awnA: "#f4f0e6", awnB: "#9ec9b4", sign: "#2f5d4d" }
      : variant === "奶油黄"
        ? { body: "#ecd28f", trim: "#b56576", awnA: "#f6ecd4", awnB: "#ecd28f", sign: "#a8543f" }
        : { body: "#d98e5f", trim: "#5a4632", awnA: "#f2e3cd", awnB: "#d98e5f", sign: "#5a4632" };
  const H = 4.6; // 两层
  // 主体
  g.add(box(w, H, d, P.body, 0, H / 2, 0));
  g.add(box(w + 0.3, 0.35, d + 0.3, P.trim, 0, H + 0.15, 0)); // 屋檐板
  // 一层橱窗 + 门（+z 面）
  g.add(box(w - 1.6, 1.9, 0.12, "#bcd8f5", -w / 2 + (w - 0.4) / 2 + 0.5, 1.15, d / 2 + 0.05));
  g.add(box(0.95, 2.2, 0.14, "#8a6a48", 0, 1.1, d / 2 + 0.05));
  // 二层窗 ×2
  g.add(box(1.3, 1.0, 0.1, "#bcd8f5", -w / 4, 3.3, d / 2 + 0.04));
  g.add(box(1.3, 1.0, 0.1, "#bcd8f5", w / 4, 3.3, d / 2 + 0.04));
  // 条纹雨棚（一排交替色小盒，微微出挑）
  const segs = Math.max(4, Math.round(w / 0.9));
  const segW = (w - 0.8) / segs;
  for (let i = 0; i < segs; i++) {
    g.add(box(segW, 0.14, 1.1, i % 2 === 0 ? P.awnA : P.awnB, -w / 2 + 0.4 + segW * (i + 0.5), 2.75, d / 2 + 0.5));
  }
  // 屋顶招牌（带文字的画布贴图，远看也读得出店名）
  const shopWords = variant === "薄荷绿" ? "CAFE" : variant === "奶油黄" ? "BAKERY" : "COFFEE";
  const signTex = textTexture(shopWords, { bg: "#f7f4ea", fg: P.sign === "#2f5d4d" ? "#2f5d4d" : P.sign, border: P.sign, w: 384, h: 112, font: 54 });
  const sign = new THREE.Mesh(new THREE.BoxGeometry(w * 0.78, 1.15, 0.16), new THREE.MeshBasicMaterial({ map: signTex }));
  sign.position.set(0, H + 0.92, d / 2 - 0.06);
  g.add(sign);
  g.add(box(w * 0.82, 1.3, 0.08, P.trim, 0, H + 0.92, d / 2 - 0.14));
  // 侧窗（x 两侧各一）+ 窗上小遮阳
  g.add(box(0.1, 1.2, 1.6, "#bcd8f5", w / 2 + 0.04, 1.3, 0));
  g.add(box(0.1, 1.2, 1.6, "#bcd8f5", -w / 2 - 0.04, 1.3, 0));
  g.add(box(0.34, 0.08, 1.8, P.awnA, w / 2 + 0.16, 2.0, 0));
  g.add(box(0.34, 0.08, 1.8, P.awnA, -w / 2 - 0.16, 2.0, 0));
  // 墙裙（底部深色收边）
  g.add(box(w + 0.06, 0.5, d + 0.06, P.trim, 0, 0.25, 0));
}

/** 便利店（系统地标，致敬 konbini 微缩景观）：白盒+蓝檐+大玻璃橱窗透亮内饰+贩卖机×2+发光招牌，门朝 +z */
function buildKonbini(params: Record<string, unknown>, g: THREE.Group) {
  const w = Math.min(12, Math.max(10, Number(params?.w ?? 11)));
  const d = Math.min(8, Math.max(6, Number(params?.d ?? 7)));
  const H = 3.3;

  // 主体白盒（后墙/侧墙/矮前墙）
  g.add(box(w, H, d, "#f2ede2", 0, H / 2, 0));
  g.add(box(w + 0.5, 0.3, d + 0.5, "#303744", 0, H + 0.15, 0)); // 屋顶板
  // 檐口深蓝带 + 招牌（白底蓝字「コンビニ」自发光）
  g.add(box(w + 0.5, 0.6, 0.2, "#1e3a5f", 0, H - 0.35, d / 2 + 0.14));
  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(5.6, 1.0, 0.12),
    new THREE.MeshBasicMaterial({ map: textTexture("コンビニ", { bg: "#f4f2ec", fg: "#1e3a5f", border: "#1e3a5f" }) })
  );
  sign.position.set(0, H + 0.18, d / 2 + 0.28);
  g.add(sign);

  // 大玻璃橱窗（+z 前脸，三段，透过可见内饰）
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: "#9fd2e8",
    transparent: true,
    opacity: 0.15,
    roughness: 0.06,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const pane = (pw: number, px2: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(pw - 0.12, H - 0.75, 0.06), glassMat);
    m.position.set(px2, 0.75 + (H - 0.75) / 2, d / 2 + 0.04);
    g.add(m);
  };
  pane(2.6, -w / 2 + 1.4);
  pane(2.2, 0.15);
  pane(2.6, w / 2 - 1.4);
  for (const px2 of [-w / 2 + 1.4, -0.95, 0.95, w / 2 - 1.4]) {
    g.add(box(0.14, H - 0.75, 0.14, "#3a3f47", px2, 0.75 + (H - 0.75) / 2, d / 2 + 0.02));
  }

  // 透亮内饰（嵌在外壳里，玻璃外可见）：棋盘地板 / 货架两排彩色商品 / 后墙冷柜 / 收银台
  const ib = (c: string) => new THREE.MeshBasicMaterial({ color: c });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(w - 0.6, 0.06, d - 0.6), ib("#e8e4d8"));
  floor.position.set(0, 0.03, 0);
  g.add(floor);
  const floorGrid = new THREE.Mesh(
    new THREE.BoxGeometry(w - 0.6, 0.02, d - 0.6),
    new THREE.MeshBasicMaterial({ color: "#cfc8b8" })
  );
  floorGrid.position.set(0, 0.02, 0);
  g.add(floorGrid);
  for (const sx of [-2.2, 0.4]) {
    g.add(box(0.7, 1.5, d - 2.4, "#d8d2c4", sx, 0.78, -0.4));
    for (let tier = 0; tier < 3; tier++) {
      g.add(box(0.78, 0.06, d - 2.5, "#cfc8b8", sx, 0.5 + tier * 0.45, -0.4));
      const colors = ["#e8604a", "#53a8e0", "#f2b64e", "#7bb98a", "#c97ad8"];
      for (let i = 0; i < Math.floor(d - 2.8); i++) {
        g.add(box(0.24, 0.28, 0.26, colors[(tier * 3 + i) % 5], sx, 0.72 + tier * 0.45, -1.4 + i * 0.36));
      }
    }
  }
  g.add(box(4.4, 1.8, 0.45, "#2c3242", 1.4, 0.95, -d / 2 + 0.35)); // 后墙冷柜
  g.add(box(4.0, 1.5, 0.08, "#9fd8ef", 1.4, 1.1, -d / 2 + 0.6));
  for (let i = 0; i < 7; i++) {
    g.add(box(0.3, 0.4, 0.2, ["#e8604a", "#53a8e0", "#f2b64e"][i % 3], -0.2 + i * 0.55, 0.75 + (i % 3) * 0.45, -d / 2 + 0.45));
  }
  g.add(box(1.6, 0.9, 0.7, "#e2d6bc", w / 2 - 1.3, 0.48, d / 2 - 1.2)); // 收银台
  g.add(box(0.5, 0.35, 0.35, "#2c3242", w / 2 - 1.5, 1.15, d / 2 - 1.2));

  // 自动门（双开玻璃，门洞在中右）
  g.add(box(0.14, H - 0.75, 0.14, "#3a3f47", -1.0, 0.75 + (H - 0.75) / 2, d / 2 + 0.02));
  g.add(box(0.14, H - 0.75, 0.14, "#3a3f47", 1.3, 0.75 + (H - 0.75) / 2, d / 2 + 0.02));
  const doorGlass = new THREE.Mesh(new THREE.BoxGeometry(2.1, H - 0.78, 0.06), glassMat);
  doorGlass.position.set(0.15, 0.78 + (H - 0.78) / 2, d / 2 + 0.05);
  g.add(doorGlass);
  // 感应盒 + 地垫
  g.add(box(0.4, 0.16, 0.2, "#3a3f47", 0.15, H - 0.42, d / 2 + 0.16));
  g.add(box(1.7, 0.05, 0.9, "#3d4252", 0.15, 0.03, d / 2 + 0.55));

  // 屋檐雨棚（门前）
  g.add(box(w * 0.55, 0.14, 1.2, "#3a6ea8", -w * 0.1, 2.62, d / 2 + 0.5));

  // 贩卖机 ×2（门前右侧贴墙）
  const vend = (vx: number, color: string) => {
    g.add(box(1.0, 1.85, 0.75, color, vx, 0.93, d / 2 + 0.35));
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.25, 0.06), ib("#bfd8e8"));
    face.position.set(vx, 1.12, d / 2 + 0.74);
    g.add(face);
    for (let i = 0; i < 4; i++) {
      g.add(box(0.1, 0.1, 0.05, "#ffdfae", vx - 0.28 + i * 0.2, 1.56, d / 2 + 0.78));
    }
  };
  vend(w / 2 - 0.8, "#c9503e");
  vend(w / 2 - 0.8 - 1.15, "#3a6ea8");

  // 空调外机（右墙高位）+ 公告栏（左墙）
  g.add(box(0.85, 0.66, 0.4, "#d8d4ca", w / 2 + 0.18, 2.55, -d / 4));
  g.add(box(1.5, 1.05, 0.08, "#6b4a2f", -w / 2 - 0.06, 1.7, -d / 6));
  for (const [yy, cc] of [[1.85, "#f2e3cd"], [1.5, "#bcd8f5"]] as Array<[number, string]>) {
    g.add(box(0.55, 0.4, 0.04, cc, -w / 2 - 0.12, yy, -d / 6));
  }
}

/** 路灯（街景）：基座 + 锥度灯杆 + 横臂 + 自发光暖光灯罩 */
function buildLamp(g: THREE.Group) {
  g.add(cyl(0.16, 0.2, 0.18, "#6f6a60", 0, 0.09, 0)); // 基座
  g.add(cyl(0.05, 0.075, 2.6, "#3d4247", 0, 1.48, 0)); // 杆
  g.add(box(0.08, 0.08, 0.72, "#3d4247", 0, 2.72, 0.34)); // 横臂（朝 +z）
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 12), new THREE.MeshBasicMaterial({ color: "#ffe9b8" }));
  bulb.position.set(0, 2.66, 0.62);
  g.add(bulb); // 自发光灯罩
  g.add(cyl(0.1, 0.14, 0.08, "#3d4247", 0, 2.86, 0.62)); // 灯帽
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
    case "office":
      buildOfficeBuilding(g);
      labelY = 6.0;
      break;
    case "tower": {
      const p = o.params ?? {};
      buildTower(o.variant, p, g);
      const floors = Math.min(12, Math.max(4, Number(p.f ?? 6)));
      labelY = 2.8 + floors * 3 + 2;
      break;
    }
    case "shop":
      buildShop(o.variant, o.params ?? {}, g);
      labelY = 6.8;
      break;
    case "konbini":
      buildKonbini(o.params ?? {}, g);
      labelY = 7.5;
      break;
    case "lamp":
      buildLamp(g);
      labelY = 0;
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
