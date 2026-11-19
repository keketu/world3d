// 网格 A* 寻路：障碍物来自共享布局，格子 0.5m，含路径平滑
import { OBSTACLES, ROOM } from "@world3d/shared";

const CELL = 0.5;
const COLS = Math.round(ROOM.width / CELL); // 52
const ROWS = Math.round(ROOM.depth / CELL); // 36
const MARGIN = 0.32; // 角色半径 + 余量

function buildBlocked(): Uint8Array {
  const blocked = new Uint8Array(COLS * ROWS);
  const at = (col: number, row: number) => row * COLS + col;
  // 边界墙
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      const x = -ROOM.width / 2 + (c + 0.5) * CELL;
      const z = -ROOM.depth / 2 + (r + 0.5) * CELL;
      if (x < -ROOM.width / 2 + MARGIN || x > ROOM.width / 2 - MARGIN || z < -ROOM.depth / 2 + MARGIN || z > ROOM.depth / 2 - MARGIN) {
        blocked[at(c, r)] = 1;
      }
    }
  }
  // 家具障碍（外扩 MARGIN）
  for (const [x0, z0, x1, z1] of OBSTACLES) {
    const c0 = Math.floor((x0 - MARGIN + ROOM.width / 2) / CELL);
    const c1 = Math.ceil((x1 + MARGIN + ROOM.width / 2) / CELL);
    const r0 = Math.floor((z0 - MARGIN + ROOM.depth / 2) / CELL);
    const r1 = Math.ceil((z1 + MARGIN + ROOM.depth / 2) / CELL);
    for (let c = Math.max(0, c0); c <= Math.min(COLS - 1, c1); c++) {
      for (let r = Math.max(0, r0); r <= Math.min(ROWS - 1, r1); r++) {
        blocked[at(c, r)] = 1;
      }
    }
  }
  return blocked;
}

const BLOCKED = buildBlocked();

function worldToCell(x: number, z: number): [number, number] {
  return [
    Math.min(COLS - 1, Math.max(0, Math.floor((x + ROOM.width / 2) / CELL))),
    Math.min(ROWS - 1, Math.max(0, Math.floor((z + ROOM.depth / 2) / CELL))),
  ];
}

function cellToWorld(c: number, r: number): { x: number; z: number } {
  return { x: -ROOM.width / 2 + (c + 0.5) * CELL, z: -ROOM.depth / 2 + (r + 0.5) * CELL };
}

function isBlocked(c: number, r: number) {
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return true;
  return BLOCKED[r * COLS + c] === 1;
}

// 就近自由格：目标点若在障碍里（如椅子贴桌），往周围找最近的可行格
function nearestFree(c: number, r: number): [number, number] {
  if (!isBlocked(c, r)) return [c, r];
  for (let rad = 1; rad <= 6; rad++) {
    for (let dc = -rad; dc <= rad; dc++) {
      for (let dr = -rad; dr <= rad; dr++) {
        if (Math.abs(dc) !== rad && Math.abs(dr) !== rad) continue;
        if (!isBlocked(c + dc, r + dr)) return [c + dc, r + dr];
      }
    }
  }
  return [c, r];
}

interface Node {
  c: number;
  r: number;
  g: number;
  f: number;
  parent?: Node;
}

function astar(sc: number, sr: number, tc: number, tr: number): Array<{ c: number; r: number }> {
  const open: Node[] = [{ c: sc, r: sr, g: 0, f: 0 }];
  const seen = new Map<number, number>(); // key -> g
  const key = (c: number, r: number) => r * COLS + c;
  seen.set(key(sc, sr), 0);

  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (cur.c === tc && cur.r === tr) {
      const path: Array<{ c: number; r: number }> = [];
      let n: Node | undefined = cur;
      while (n) {
        path.push({ c: n.c, r: n.r });
        n = n.parent;
      }
      return path.reverse();
    }
    const dirs = [
      [1, 0, 1],
      [-1, 0, 1],
      [0, 1, 1],
      [0, -1, 1],
      [1, 1, 1.414],
      [1, -1, 1.414],
      [-1, 1, 1.414],
      [-1, -1, 1.414],
    ];
    for (const [dc, dr, cost] of dirs) {
      const nc = cur.c + dc;
      const nr = cur.r + dr;
      if (isBlocked(nc, nr)) continue;
      // 防止对角穿墙缝
      if (dc !== 0 && dr !== 0 && (isBlocked(cur.c + dc, cur.r) || isBlocked(cur.c, cur.r + dr))) continue;
      const g = cur.g + cost;
      const k = key(nc, nr);
      const prev = seen.get(k);
      if (prev !== undefined && prev <= g) continue;
      seen.set(k, g);
      const h = Math.hypot(tc - nc, tr - nr);
      open.push({ c: nc, r: nr, g, f: g + h, parent: cur });
    }
  }
  return [{ c: sc, r: sr }, { c: tc, r: tr }]; // 找不到路就直接走直线（兜底）
}

// 直线可见性（用于路径平滑），按步进采样
function los(x0: number, z0: number, x1: number, z1: number): boolean {
  const dist = Math.hypot(x1 - x0, z1 - z0);
  const steps = Math.ceil(dist / (CELL * 0.5));
  for (let i = 0; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps;
    const z = z0 + ((z1 - z0) * i) / steps;
    const [c, r] = worldToCell(x, z);
    if (isBlocked(c, r)) return false;
  }
  return true;
}

/** 计算从 (x0,z0) 到 (x1,z1) 的世界坐标路径点序列 */
export function findPath(x0: number, z0: number, x1: number, z1: number): Array<{ x: number; z: number }> {
  const [sc, sr] = nearestFree(...worldToCell(x0, z0));
  const [tc, tr] = nearestFree(...worldToCell(x1, z1));
  const cellPath = astar(sc, sr, tc, tr);
  const worldPath = cellPath.map(({ c, r }) => cellToWorld(c, r));
  // 起点精确化
  worldPath[0] = { x: x0, z: z0 };
  // 终点精确化
  worldPath[worldPath.length - 1] = { x: x1, z: z1 };
  // 视线平滑
  const out: Array<{ x: number; z: number }> = [worldPath[0]];
  let i = 0;
  while (i < worldPath.length - 1) {
    let j = worldPath.length - 1;
    while (j > i + 1 && !los(worldPath[i].x, worldPath[i].z, worldPath[j].x, worldPath[j].z)) j--;
    out.push(worldPath[j]);
    i = j;
  }
  return out;
}
