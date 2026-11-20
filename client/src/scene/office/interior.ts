// 可进入建筑的通用室内：地板 + 三面墙（+z 门洞）+ 简单家具（house/shop/tower 各自风格）
// 玩家手搓的建筑进屋时按需构建，退出隐藏、按 roomId 缓存复用
import * as THREE from "three";
import { paintAndMerge } from "../../engine/props";

interface Part {
  geo: () => THREE.BufferGeometry;
  x: number;
  y: number;
  z: number;
  rotY?: number;
  color: string;
  glow?: boolean;
}

function box(w: number, h: number, d: number, color: string, x: number, y: number, z: number, rotY = 0, glow = false): Part {
  return { geo: () => new THREE.BoxGeometry(w, h, d), x, y, z, rotY, color, glow };
}

function cyl(r1: number, r2: number, h: number, color: string, x: number, y: number, z: number): Part {
  return { geo: () => new THREE.CylinderGeometry(r1, r2, h, 12), x, y, z, color };
}

function sph(r: number, color: string, x: number, y: number, z: number, glow = false): Part {
  return { geo: () => new THREE.SphereGeometry(r, 14, 12), x, y, z, color, glow };
}

export interface InteriorOpts {
  kind: "house" | "shop" | "tower" | "konbini";
  variant: string;
  /** 建筑外壳尺寸（与 buildHouse/buildTower/buildShop 同源的 clamp 值） */
  w: number;
  d: number;
}

export interface InteriorRoom {
  group: THREE.Group;
  /** 房间射线/点击目标 */
  solid: THREE.Mesh;
  /** 室内可行走半宽/半深（碰撞边界） */
  hw: number;
  hd: number;
}

const WALL_H = 3;

/** 阳光都市室内配色 */
function palette(kind: string, variant: string) {
  if (kind === "tower") {
    return { floor: "#dfe4de", wall: "#eef1ea", trim: "#c8cfc9", glass: "#4d7fa8", wood: "#d9b98a", fabric: "#8fb6c9" };
  }
  if (kind === "shop") {
    const body = variant === "薄荷绿" ? "#9ec9b4" : variant === "奶油黄" ? "#ecd28f" : "#d98e5f";
    return { floor: "#e7dcc4", wall: "#f2ead9", trim: body, glass: "#bcd8f5", wood: "#c9a06a", fabric: body };
  }
  // house：木屋暖色 / 石屋冷色
  const stone = variant === "石屋";
  return {
    floor: stone ? "#d5d2c8" : "#dcae7e",
    wall: stone ? "#c9c9cf" : "#f2e3cd",
    trim: stone ? "#9a9aa3" : "#8a6a48",
    glass: "#bcd8f5",
    wood: stone ? "#9a9aa3" : "#c9a06a",
    fabric: stone ? "#8a92a3" : "#d97a8c",
  };
}

/** 构建一件建筑物的室内（局部坐标：门在 +z 墙中央，房间中心为原点） */
export function buildInteriorRoom(opts: InteriorOpts): InteriorRoom {
  const group = new THREE.Group();
  const P = palette(opts.kind, opts.variant);
  // 家具布置的确定性随机（书架书宽/颜色等微差）
  const rng = (() => {
    let a = 987654321;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();
  // 室内可行走区：外壳内缩 0.7（墙厚 0.24 + 家具余量）
  const hw = Math.max(2.2, opts.w / 2 - 0.7);
  const hd = Math.max(2.2, opts.d / 2 - 0.7);
  const W = hw * 2 + 0.48; // 墙心距
  const D = hd * 2 + 0.48;
  const parts: Part[] = [];
  const doorW = 1.5;

  // 地板 + 踢脚
  parts.push(box(W, 0.12, D, P.floor, 0, -0.06, 0));
  parts.push(box(W + 0.3, 0.1, D + 0.3, P.trim, 0, -0.16, 0));
  // 后墙（-z）整面
  parts.push(box(W, WALL_H, 0.24, P.wall, 0, WALL_H / 2, -hd - 0.12));
  // 侧墙（-x / +x）
  parts.push(box(0.24, WALL_H, D, P.wall, -hw - 0.12, WALL_H / 2, 0));
  parts.push(box(0.24, WALL_H, D, P.wall, hw + 0.12, WALL_H / 2, 0));
  // 前墙（+z）：门洞居中 1.5m，两侧墙段 + 门楣
  const segW = (W - doorW) / 2;
  parts.push(box(segW, WALL_H, 0.24, P.wall, -(doorW / 2 + segW / 2), WALL_H / 2, hd + 0.12));
  parts.push(box(segW, WALL_H, 0.24, P.wall, doorW / 2 + segW / 2, WALL_H / 2, hd + 0.12));
  parts.push(box(doorW, WALL_H - 2.3, 0.24, P.wall, 0, 2.3 + (WALL_H - 2.3) / 2, hd + 0.12));
  // 门框
  parts.push(box(0.14, 2.3, 0.3, P.trim, -doorW / 2, 1.15, hd + 0.12));
  parts.push(box(0.14, 2.3, 0.3, P.trim, doorW / 2, 1.15, hd + 0.12));
  // 侧窗（-x / +x 墙，发光玻璃）
  parts.push(box(0.1, 1.1, 1.6, P.glass, -hw - 0.14, 1.5, -hd / 3, 0, true));
  parts.push(box(0.1, 1.1, 1.6, P.glass, hw + 0.14, 1.5, -hd / 3, 0, true));
  parts.push(box(0.1, 1.1, 1.6, P.glass, -hw - 0.14, 1.5, hd / 3, 0, true));
  parts.push(box(0.1, 1.1, 1.6, P.glass, hw + 0.14, 1.5, hd / 3, 0, true));
  // 后窗（-z 墙）
  parts.push(box(1.8, 1.1, 0.1, P.glass, 0, 1.5, -hd - 0.16, 0, true));

  // ---- 家具 ----
  if (opts.kind === "konbini") {
    // 便利店内饰（平涂亮色，透过玻璃/进屋都明亮）：棋盘地板 + 双排货架 + 后墙冷柜 + 收银台
    const checker = (() => {
      const c = document.createElement("canvas");
      c.width = c.height = 96;
      const gg = c.getContext("2d")!;
      gg.fillStyle = "#e8e4d8";
      gg.fillRect(0, 0, 96, 96);
      gg.fillStyle = "#c9c3b4";
      for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) if ((i + j) % 2 === 0) gg.fillRect(i * 16, j * 16, 16, 16);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    })();
    const floor = new THREE.Mesh(new THREE.BoxGeometry(W, 0.08, D), new THREE.MeshBasicMaterial({ map: checker }));
    floor.position.set(0, -0.04, 0);
    group.add(floor);
    const goods = ["#e8604a", "#53a8e0", "#f2b64e", "#7bb98a", "#c97ad8", "#f0e0e8"];
    // 双排货架（沿 x）
    for (const rz of [-hd / 2 + 0.4, hd / 2 - 1.6]) {
      group.add(new THREE.Mesh(new THREE.BoxGeometry(W - 3.4, 1.5, 0.7), new THREE.MeshBasicMaterial({ color: "#d8d2c4" })));
      const shelf = group.children[group.children.length - 1];
      shelf.position.set(0, 0.75, rz);
      for (let tier = 0; tier < 3; tier++) {
        const board = new THREE.Mesh(new THREE.BoxGeometry(W - 3.3, 0.05, 0.66), new THREE.MeshBasicMaterial({ color: "#cfc8b8" }));
        board.position.set(0, 0.42 + tier * 0.45, rz);
        group.add(board);
        const cols = Math.floor((W - 3.6) / 0.4);
        for (let i = 0; i < cols; i++) {
          const it = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.28, 0.26), new THREE.MeshBasicMaterial({ color: goods[(tier * 2 + i) % goods.length] }));
          it.position.set(-(W - 3.8) / 2 + 0.2 + i * 0.4, 0.62 + tier * 0.45, rz);
          group.add(it);
        }
      }
    }
    // 后墙冷柜（-z）
    const cooler = new THREE.Mesh(new THREE.BoxGeometry(W - 4, 1.8, 0.4), new THREE.MeshBasicMaterial({ color: "#2c3242" }));
    cooler.position.set(0, 0.95, -hd + 0.28);
    group.add(cooler);
    const coolerGlass = new THREE.Mesh(new THREE.BoxGeometry(W - 4.3, 1.5, 0.06), new THREE.MeshBasicMaterial({ color: "#9fd8ef" }));
    coolerGlass.position.set(0, 0.98, -hd + 0.5);
    group.add(coolerGlass);
    // 收银台（+z 角）
    const counter = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 0.7), new THREE.MeshBasicMaterial({ color: "#e2d6bc" }));
    counter.position.set(hw - 1.3, 0.45, hd - 0.9);
    group.add(counter);
  } else if (opts.kind === "house") {
    // 地毯 + 床（枕头/褥子/床尾板）+ 书桌椅 + 书架 + 挂画 + 吊灯
    parts.push(box(2.2, 0.04, 1.8, "#c96a5a", -hw / 2, 0.02, hd / 2)); // 地毯
    parts.push(box(1.5, 0.3, 2.4, P.fabric, -hw + 1.0, 0.22, -hd + 1.5));
    parts.push(box(1.36, 0.1, 2.26, "#f7f4ea", -hw + 1.0, 0.4, -hd + 1.5)); // 褥子
    parts.push(box(1.2, 0.18, 0.5, "#f7f4ea", -hw + 1.0, 0.5, -hd + 0.75)); // 枕头
    parts.push(box(1.44, 0.08, 0.1, P.trim, -hw + 1.0, 0.42, -hd + 2.72)); // 床尾板
    parts.push(box(1.4, 0.08, 0.9, P.wood, hw - 1.4, 0.75, hd - 1.6));
    for (const [lx, lz] of [[-0.55, -0.3], [0.55, -0.3], [-0.55, 0.3], [0.55, 0.3]]) {
      parts.push(cyl(0.05, 0.05, 0.75, P.trim, hw - 1.4 + lx, 0.38, hd - 1.6 + lz));
    }
    parts.push(cyl(0.05, 0.05, 0.5, P.wood, hw - 1.4, 1.05, hd - 1.6));
    // 书架（-z 墙边）：框架 + 三层书
    parts.push(box(1.8, 1.9, 0.36, P.wood, -hw + 1.2, 0.95, -hd + 0.25));
    for (let i = 0; i < 3; i++) {
      parts.push(box(1.6, 0.07, 0.3, "#f7f4ea", -hw + 1.2, 0.5 + i * 0.6, -hd + 0.25));
      let bx = -hw + 0.55;
      while (bx < -hw + 1.8) {
        const bw = 0.08 + rng() * 0.12;
        const colors = ["#e2907e", "#7aa6d8", "#7bb98a", "#e8c45a", "#b56a4e"];
        parts.push(box(bw, 0.36, 0.24, colors[Math.floor(rng() * colors.length)], bx + bw / 2, 0.7 + i * 0.6, -hd + 0.25));
        bx += bw + 0.04;
      }
    }
    // 挂画（-z 墙）
    parts.push(box(1.1, 0.8, 0.06, P.wood, hw - 1.5, 1.7, -hd + 0.1));
    parts.push(box(0.94, 0.64, 0.04, "#bcd8f5", hw - 1.5, 1.7, -hd + 0.16));
    parts.push(sph(0.2, "#f2d998", 0, 2.6, 0, true));
    } else if (opts.kind === "shop") {
    // 柜台（中后）+ 货架 ×2（-x / -z 墙边）+ 圆凳
    parts.push(box(2.6, 0.95, 0.7, P.wood, 0, 0.48, -hd + 1.2));
    parts.push(box(2.6, 0.08, 0.8, "#f7f4ea", 0, 1.0, -hd + 1.2));
    for (const [sx, sz, rot] of [[-hw + 0.5, 0, Math.PI / 2], [0, -hd + 1.2 + 0.9, 0]] as Array<[number, number, number]>) {
      parts.push(box(rot === 0 ? 1.8 : 0.5, 2.2, rot === 0 ? 0.5 : 1.8, P.trim, sx, 1.1, sz));
      for (let i = 0; i < 3; i++) {
        parts.push(box(rot === 0 ? 1.6 : 0.3, 0.08, rot === 0 ? 0.34 : 1.6, "#f7f4ea", sx, 0.7 + i * 0.65, sz));
      }
    }
    for (const [lx, lz] of [[-1, 1.6], [1, 1.6]]) {
      parts.push(cyl(0.22, 0.24, 0.08, P.fabric, lx, 0.45, lz));
      parts.push(cyl(0.04, 0.04, 0.42, P.trim, lx, 0.2, lz));
    }
    parts.push(sph(0.18, "#f2d998", 0, 2.6, -hd + 1.2, true));
  } else {
    // tower：会议桌 + 椅子 ×4 + 绿植 + 白板
    parts.push(box(3.2, 0.1, 1.4, P.wood, 0, 0.75, -hd + 1.6));
    for (const [lx, lz] of [[-1.4, -0.5], [1.4, -0.5], [-1.4, 0.5], [1.4, 0.5]]) {
      parts.push(cyl(0.06, 0.06, 0.75, P.trim, lx, 0.38, -hd + 1.6 + lz));
    }
    for (const [lx, lz, rot] of [[-0.9, -hd + 1.6, Math.PI / 2], [0.9, -hd + 1.6, Math.PI / 2], [0, -hd + 2.5, 0]] as Array<[number, number, number]>) {
      parts.push(cyl(0.24, 0.26, 0.08, P.fabric, lx, 0.45, lz));
      parts.push(box(0.44, 0.44, 0.06, P.fabric, lx, 0.7, lz + 0.2, rot));
      parts.push(cyl(0.035, 0.035, 0.4, P.trim, lx, 0.2, lz));
    }
    parts.push(cyl(0.3, 0.36, 0.5, P.wood, hw - 0.9, 0.25, -hd + 0.9));
    parts.push(sph(0.42, "#5da45e", hw - 0.9, 0.85, -hd + 0.9));
    parts.push(box(2.0, 1.2, 0.08, "#f7f4ea", 0, 1.6, -hd + 0.16));
    parts.push(box(1.7, 0.6, 0.02, "#e2907e", -0.2, 1.6, -hd + 0.24));
    parts.push(sph(0.18, "#f2d998", 0, 2.7, 0, true));
  }

  const solid = new THREE.Mesh(paintAndMerge2(parts), new THREE.MeshLambertMaterial({ vertexColors: true }));
  solid.name = "interiorSolid";
  group.add(solid);

  // 室内灯（挂 group 下，随 group 显隐）
  const lamp = new THREE.PointLight(0xfff2dd, 0.8, Math.max(W, D) * 1.2);
  lamp.position.set(0, 2.6, 0);
  group.add(lamp);
  const lamp2 = new THREE.PointLight(0xfff2dd, 0.5, Math.max(W, D));
  lamp2.position.set(0, 2.4, hd - 1);
  group.add(lamp2);

  return { group, solid, hw, hd };
}

/** Part[] → 合并网格（room.ts 的 paintAndMerge 签名需要 group，这里直接组装顶点序列） */
function paintAndMerge2(parts: Part[]): THREE.BufferGeometry {
  const group = new THREE.Group();
  for (const p of parts) {
    const m = new THREE.Mesh(p.geo(), new THREE.MeshLambertMaterial({ color: p.color }));
    m.position.set(p.x, p.y, p.z);
    if (p.rotY) m.rotation.y = p.rotY;
    group.add(m);
  }
  return paintAndMerge(group);
}
