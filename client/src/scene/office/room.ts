// Office 房间室内几何：office3d 办公室的 world3d 低模移植
// 静态物合并为两块网格：不发光主体（Lambert 顶点色）+ 发光件（屏幕/窗/灯罩，Basic 顶点色）
import * as THREE from "three";
import { BOSS_SPOT, EMPLOYEE_DESKS, EXTRA_DESKS, MEETING, PM_SPOT, WHITEBOARD, ROOM } from "@world3d/shared";
import { paintAndMerge } from "../../engine/props";

// 暖纸色 + 樱花粉调色板，对齐世界审美
const C = {
  floor: "#e8dfce",
  floorSeam: "#d9cfba",
  rugA: "#e9c8ce",
  rugB: "#c8dde4",
  wall: "#f2ead9",
  wallTrim: "#d9cdb4",
  windowPane: "#cfe8f2",
  windowFrame: "#8a7c62",
  wood: "#c9a06a",
  woodDark: "#8a6a48",
  deskTop: "#e7d3ae",
  metal: "#9a948a",
  screen: "#2e3540",
  screenOn: "#9fd8ef",
  chairSeat: "#d97a8c",
  chairLeg: "#5a544a",
  tableWood: "#d9b98a",
  whiteboard: "#f7f4ea",
  boardMark1: "#e2907e",
  boardMark2: "#7aa6d8",
  boardMark3: "#7bb98a",
  sofa: "#d9a0aa",
  plant: "#5da45e",
  plantPot: "#c96a5a",
  lamp: "#f2d998",
  counter: "#e2cfa8",
  machine: "#5a544a",
  trophy: "#e8c45a",
  door: "#a8805a",
  doormat: "#db8f9f",
};

interface Part {
  geo: () => THREE.BufferGeometry;
  x: number;
  y: number;
  z: number;
  rotY?: number;
  scale?: [number, number, number];
  color: string;
  glow?: boolean;
}

function box(w: number, h: number, d: number, color: string, x: number, y: number, z: number, rotY = 0, glow = false): Part {
  return { geo: () => new THREE.BoxGeometry(w, h, d), x, y, z, rotY, color, glow };
}

function cyl(r1: number, r2: number, h: number, color: string, x: number, y: number, z: number, rotY = 0, glow = false, seg = 12): Part {
  return { geo: () => new THREE.CylinderGeometry(r1, r2, h, seg), x, y, z, rotY, color, glow };
}

function sph(r: number, color: string, x: number, y: number, z: number, glow = false): Part {
  return { geo: () => new THREE.SphereGeometry(r, 14, 12), x, y, z, color, glow };
}

// 单个工位（桌板 + 桌腿 + 显示器 + 键盘 + 杯子）
function workstation(parts: Part[], cx: number, cz: number, rotY: number) {
  const cos = Math.cos(rotY);
  const sin = Math.sin(rotY);
  const at = (lx: number, lz: number, ly: number) => ({
    x: cx + lx * cos + lz * sin,
    z: cz - lx * sin + lz * cos,
    y: ly,
  });
  // 桌板 2.1×0.9 @0.72
  parts.push(box(2.1, 0.08, 0.9, C.deskTop, at(0, 0, 0.72).x, 0.72, at(0, 0, 0.72).z, rotY));
  // 桌腿 ×4
  for (const [lx, lz] of [
    [-0.95, -0.35],
    [0.95, -0.35],
    [-0.95, 0.35],
    [0.95, 0.35],
  ]) {
    const p = at(lx, lz, 0);
    parts.push(cyl(0.04, 0.04, 0.72, C.metal, p.x, 0.36, p.z));
  }
  // 显示器（屏幕朝座椅方向 = -z 局部）
  const mon = at(0, -0.28, 0.72);
  parts.push(box(0.62, 0.4, 0.04, C.screen, mon.x, 1.02, mon.z, rotY));
  const scr = at(0, -0.255, 0.72);
  parts.push(box(0.54, 0.32, 0.012, C.screenOn, scr.x, 1.02, scr.z, rotY, true));
  const stem = at(0, -0.18, 0.72);
  parts.push(cyl(0.03, 0.03, 0.16, C.metal, stem.x, 0.8, stem.z));
  // 键盘 + 杯子
  const kb = at(0, 0.02, 0.78);
  parts.push(box(0.42, 0.03, 0.16, C.woodDark, kb.x, 0.76, kb.z, rotY));
  const mug = at(0.6, 0.05, 0.72);
  parts.push(cyl(0.05, 0.05, 0.1, C.doormat, mug.x, 0.8, mug.z));
}

// 椅子（座 + 靠背 + 中柱 + 底脚）
function chair(parts: Part[], cx: number, cz: number, rotY: number) {
  const cos = Math.cos(rotY);
  const sin = Math.sin(rotY);
  const at = (lx: number, lz: number, ly: number) => ({
    x: cx + lx * cos + lz * sin,
    z: cz - lx * sin + lz * cos,
    y: ly,
  });
  parts.push(cyl(0.24, 0.26, 0.08, C.chairSeat, cx, 0.42, cz, rotY));
  const back = at(0, 0.22, 0.62);
  parts.push(box(0.44, 0.44, 0.06, C.chairSeat, back.x, 0.68, back.z, rotY));
  parts.push(cyl(0.035, 0.035, 0.36, C.chairLeg, cx, 0.2, cz));
  parts.push(cyl(0.22, 0.22, 0.03, C.chairLeg, cx, 0.03, cz));
}

/** 构建整个室内房间（静态，一次构建多次进出复用） */
export function buildOfficeRoom(): THREE.Group {
  const group = new THREE.Group();
  const parts: Part[] = [];
  const W = ROOM.width; // 26
  const D = ROOM.depth; // 18
  const H = ROOM.wallHeight; // 3.2

  // ---- 地板（大面积露台打底 + 室内地板 + 接缝条 + 两块地毯） ----
  parts.push(box(W + 16, 0.12, D + 12, "#d4c8b0", 0, -0.07, 0)); // 露台底（防穿帮到天空）
  parts.push(box(W, 0.1, D, C.floor, 0, -0.05, 0));
  parts.push(box(W, 0.02, 0.16, C.floorSeam, 0, 0.005, 0));
  parts.push(box(W, 0.02, 0.16, C.floorSeam, 0, 0.005, -D / 4));
  parts.push(box(W, 0.02, 0.16, C.floorSeam, 0, 0.005, D / 4));
  parts.push(box(4.4, 0.02, 2.6, C.rugA, -6.5, 0.01, 0));
  parts.push(box(3.2, 0.02, 2.2, C.rugB, 8.2, 0.01, 3.2));

  // ---- 墙：北/西/东整面，南墙留门洞（门宽 2，居中） ----
  parts.push(box(W, H, 0.18, C.wall, 0, H / 2, -D / 2)); // 北
  parts.push(box(0.18, H, D, C.wall, -W / 2, H / 2, 0)); // 西
  parts.push(box(0.18, H, D, C.wall, W / 2, H / 2, 0)); // 东
  // 南墙两段（门洞 x -1..1）
  const segW = W / 2 - 1;
  parts.push(box(segW, H, 0.18, C.wall, -(1 + segW / 2), H / 2, D / 2));
  parts.push(box(segW, H, 0.18, C.wall, 1 + segW / 2, H / 2, D / 2));
  // 门楣
  parts.push(box(2, 0.7, 0.18, C.wall, 0, H - 0.35, D / 2));
  // 门框 + 门垫
  parts.push(box(0.16, 2.5, 0.24, C.woodDark, -1, 1.25, D / 2));
  parts.push(box(0.16, 2.5, 0.24, C.woodDark, 1, 1.25, D / 2));
  parts.push(box(1.9, 0.03, 1.2, C.doormat, 0, 0.02, D / 2 - 0.7));
  // 踢脚线
  parts.push(box(W, 0.16, 0.06, C.wallTrim, 0, 0.08, -D / 2 + 0.13));
  parts.push(box(0.06, 0.16, D, C.wallTrim, -W / 2 + 0.13, 0.08, 0));
  parts.push(box(0.06, 0.16, D, C.wallTrim, W / 2 - 0.13, 0.08, 0));

  // ---- 北墙三扇窗（发光窗面 + 窗框） ----
  for (const wx of [-6.5, 0, 6.5]) {
    parts.push(box(3.4, 1.5, 0.1, C.windowFrame, wx, 1.7, -D / 2 + 0.14));
    parts.push(box(3.0, 1.14, 0.06, C.windowPane, wx, 1.7, -D / 2 + 0.2, 0, true));
    parts.push(box(3.1, 0.06, 0.08, C.windowFrame, wx, 1.7, -D / 2 + 0.22));
    parts.push(box(0.06, 1.2, 0.08, C.windowFrame, wx, 1.7, -D / 2 + 0.22));
  }

  // ---- 员工/PM 工位 + 椅子（EXTRA_DESKS = 玩家雇佣的个人 agent 加座） ----
  for (const d of [...EMPLOYEE_DESKS, ...EXTRA_DESKS]) {
    workstation(parts, d.desk.x, d.desk.z, d.desk.rotY);
    chair(parts, d.seat.x, d.seat.z, d.seat.rotY);
  }
  workstation(parts, PM_SPOT.desk.x, PM_SPOT.desk.z, PM_SPOT.desk.rotY);
  chair(parts, PM_SPOT.seat.x, PM_SPOT.seat.z, PM_SPOT.seat.rotY);

  // ---- 老板角（大桌 + 双屏 + 奖杯 + 椅） ----
  {
    const { x, z } = BOSS_SPOT.desk;
    parts.push(box(2.6, 0.1, 1.2, C.woodDark, x, 0.74, z));
    for (const [lx, lz] of [
      [-1.15, -0.45],
      [1.15, -0.45],
      [-1.15, 0.45],
      [1.15, 0.45],
    ])
      parts.push(cyl(0.05, 0.05, 0.72, C.wood, x + lx, 0.36, z + lz));
    parts.push(box(0.62, 0.4, 0.04, C.screen, x - 0.5, 1.06, z - 0.2));
    parts.push(box(0.54, 0.32, 0.012, C.screenOn, x - 0.5, 1.06, z - 0.235, 0, true));
    parts.push(box(0.62, 0.4, 0.04, C.screen, x + 0.5, 1.06, z - 0.2));
    parts.push(box(0.54, 0.32, 0.012, C.screenOn, x + 0.5, 1.06, z - 0.235, 0, true));
    parts.push(cyl(0.07, 0.09, 0.22, C.trophy, x + 1.0, 0.9, z));
    chair(parts, BOSS_SPOT.seat.x, BOSS_SPOT.seat.z, BOSS_SPOT.seat.rotY);
  }

  // ---- 会议室（圆桌 + 6 椅） ----
  {
    const t = MEETING.table;
    parts.push(cyl(t.radius, t.radius, 0.09, C.tableWood, t.x, 0.72, t.z, 0, false, 20));
    parts.push(cyl(0.14, 0.2, 0.72, C.woodDark, t.x, 0.36, t.z, 0, false, 10));
    for (const s of MEETING.seats) chair(parts, s.x, s.z, s.rotY);
  }

  // ---- 白板（西墙） + 板上笔迹 ----
  {
    const wb = WHITEBOARD;
    const cos = Math.cos(wb.rotY);
    const sin = Math.sin(wb.rotY);
    const at = (lz: number, ly: number) => ({ x: wb.x + lz * sin, z: wb.z + lz * cos, y: ly });
    parts.push(box(0.08, 1.2, 2.0, C.whiteboard, at(0.16, 1.7).x, 1.7, at(0.16, 1.7).z));
    parts.push(box(0.06, 1.26, 2.1, C.woodDark, at(0.12, 1.7).x, 1.7, at(0.12, 1.7).z));
    const m1 = at(0.22, 1.55);
    parts.push(box(0.02, 0.07, 1.1, C.boardMark1, m1.x, 1.55, m1.z));
    const m2 = at(0.22, 1.75);
    parts.push(box(0.02, 0.06, 0.8, C.boardMark2, m2.x, 1.75, m2.z));
    const m3 = at(0.22, 1.95);
    parts.push(box(0.02, 0.06, 1.0, C.boardMark3, m3.x, 1.95, m3.z));
  }

  // ---- 咖啡角（吧台 + 咖啡机 + 杯塔） ----
  {
    parts.push(box(1.8, 0.9, 0.6, C.counter, 11.3, 0.45, 5.5));
    parts.push(box(1.7, 0.06, 0.54, C.woodDark, 11.3, 0.93, 5.5));
    parts.push(box(0.5, 0.42, 0.4, C.machine, 11.0, 1.17, 5.5));
    for (let i = 0; i < 4; i++)
      parts.push(cyl(0.055, 0.045, 0.09, C.windowPane, 11.75, 1.0 + i * 0.095, 5.3 + (i % 2) * 0.18));
  }

  // ---- 沙发休息区（东南） ----
  {
    parts.push(box(2.6, 0.42, 1.0, C.sofa, 0.5, 0.21, 6.9));
    parts.push(box(2.6, 0.5, 0.22, C.sofa, 0.5, 0.62, 7.4));
    parts.push(box(0.22, 0.62, 1.0, C.sofa, -0.85, 0.35, 6.9));
    parts.push(box(0.22, 0.62, 1.0, C.sofa, 1.85, 0.35, 6.9));
    parts.push(cyl(0.24, 0.3, 0.06, C.woodDark, 2.6, 0.42, 6.6, 0, false, 14)); // 小圆几
    parts.push(cyl(0.05, 0.05, 0.4, C.woodDark, 2.6, 0.2, 6.6));
  }

  // ---- 绿植 ×5 ----
  for (const [px, pz] of [
    [-12.2, 8.3],
    [12.3, 8.3],
    [-12.2, -8.3],
    [3.5, -8.3],
    [5.7, 8.1],
  ]) {
    parts.push(cyl(0.28, 0.22, 0.4, C.plantPot, px, 0.2, pz));
    parts.push(sph(0.42, C.plant, px, 0.72, pz));
    parts.push(sph(0.3, "#6bb46a", px + 0.18, 0.92, pz + 0.1));
  }

  // ---- 打印机柜（北墙） ----
  parts.push(box(2.0, 0.8, 0.55, C.counter, -1.2, 0.4, -8.2));
  parts.push(box(0.7, 0.35, 0.5, C.metal, -1.2, 0.97, -8.2));

  // ---- 吊灯罩 ×3（发光，光源在 roomHost 挂） ----
  for (const lx of [-6, 0, 6]) {
    parts.push(cyl(0.02, 0.02, 0.5, C.metal, lx, 2.95, 0));
    parts.push(cyl(0.3, 0.42, 0.26, C.lamp, lx, 2.7, 0, 0, true, 14));
  }

  // ---- 合并：主体（受光）+ 发光件（自亮） ----
  const build = (glow: boolean) => {
    const g = new THREE.Group();
    for (const p of parts) {
      if (!!p.glow !== glow) continue;
      const m = new THREE.Mesh(p.geo(), new THREE.MeshLambertMaterial({ color: p.color }));
      m.position.set(p.x, p.y, p.z);
      if (p.rotY) m.rotation.y = p.rotY;
      g.add(m);
    }
    return g;
  };

  const solid = new THREE.Mesh(paintAndMerge(build(false)), new THREE.MeshLambertMaterial({ vertexColors: true }));
  solid.name = "officeSolid";
  group.add(solid);
  const glowParts = build(true);
  const glow = new THREE.Mesh(paintAndMerge(glowParts), new THREE.MeshBasicMaterial({ vertexColors: true }));
  glow.name = "officeGlow";
  group.add(glow);

  return group;
}

/** 房间碰撞：点是否在障碍物/墙内（玩家行走用，与 nav 的 OBSTACLES 同源） */
export function roomBlocked(x: number, z: number): boolean {
  const m = 0.32;
  if (x < -ROOM.width / 2 + m || x > ROOM.width / 2 - m || z < -ROOM.depth / 2 + m || z > ROOM.depth / 2 - m) {
    // 南门洞放行（x ∈ [-0.9,0.9] 且 z 接近门）
    if (!(Math.abs(x) < 0.9 && z > ROOM.depth / 2 - 0.6)) return true;
  }
  for (const [x0, z0, x1, z1] of OBSTACLE_RECTS) {
    if (x > x0 - m && x < x1 + m && z > z0 - m && z < z1 + m) return true;
  }
  return false;
}

import { OBSTACLES } from "@world3d/shared";
const OBSTACLE_RECTS = OBSTACLES;
