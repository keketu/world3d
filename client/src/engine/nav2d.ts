// 户外寻路：网格 A*（建筑矩形 + 街具圆形为障碍），含路径平滑
// 与房间内的 nav.ts 同思路，但网格覆盖整张世界地图（256m）
import type { WorldObject } from "@world3d/shared";
import { isBuildingKind, buildingRect, isPropCollidable } from "@world3d/shared";
import type { Collider } from "./colliderGrid";

const CELL = 1.5;
const SIZE = 256;
const COLS = Math.round(SIZE / CELL); // 171
const MARGIN = 0.45; // 角色半径 + 余量

export interface NavGrid {
  cols: number;
  blocked: Uint8Array;
}

const at = (c: number, r: number) => r * COLS + c;

export function worldToCell(x: number, z: number): [number, number] {
  return [
    Math.min(COLS - 1, Math.max(0, Math.floor(x / CELL))),
    Math.min(COLS - 1, Math.max(0, Math.floor(z / CELL))),
  ];
}
export function cellToWorld(c: number, r: number): { x: number; z: number } {
  return { x: (c + 0.5) * CELL, z: (r + 0.5) * CELL };
}

/** 按造物和街具建不可走网格（只标记障碍覆盖的格子，开销与障碍面积成正比） */
export function buildNavGrid(objects: Iterable<WorldObject>, extras: Collider[]): NavGrid {
  const blocked = new Uint8Array(COLS * COLS);
  const markBox = (x0: number, z0: number, x1: number, z1: number) => {
    const c0 = Math.max(0, Math.floor(x0 / CELL));
    const c1 = Math.min(COLS - 1, Math.floor(x1 / CELL));
    const r0 = Math.max(0, Math.floor(z0 / CELL));
    const r1 = Math.min(COLS - 1, Math.floor(z1 / CELL));
    for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) blocked[at(c, r)] = 1;
  };
  const markCircle = (x: number, z: number, rad: number) => {
    markBox(x - rad, z - rad, x + rad, z + rad);
  };
  // 建筑：旋转矩形的 AABB 近似（偏保守，宁可多挡一点也别穿墙）
  for (const o of objects) {
    if (!isBuildingKind(o.kind)) continue;
    const rect = buildingRect(o.kind, o.params, o.scale || 1);
    if (!rect) continue;
    const rx = Math.abs(Math.cos(o.rotY)) * rect.hw + Math.abs(Math.sin(o.rotY)) * rect.hd;
    const rz = Math.abs(Math.sin(o.rotY)) * rect.hw + Math.abs(Math.cos(o.rotY)) * rect.hd;
    markBox(o.x - rx - MARGIN, o.z - rz - MARGIN, o.x + rx + MARGIN, o.z + rz + MARGIN);
  }
  // 小件造物（树/花/围栏…）
  for (const o of objects) {
    if (isBuildingKind(o.kind)) continue;
    const cr = isPropCollidable(o.kind) * (o.scale || 1) * 0.8;
    if (cr <= 0) continue;
    markCircle(o.x, o.z, cr + MARGIN);
  }
  // 街景陈设（长椅/灯柱/车…）
  for (const c of extras) {
    if (c.r > 0) markCircle(c.x, c.z, c.r + MARGIN);
    else {
      const rx = Math.abs(Math.cos(c.rotY)) * c.hw + Math.abs(Math.sin(c.rotY)) * c.hd;
      const rz = Math.abs(Math.sin(c.rotY)) * c.hw + Math.abs(Math.cos(c.rotY)) * c.hd;
      markBox(c.x - rx - MARGIN, c.z - rz - MARGIN, c.x + rx + MARGIN, c.z + rz + MARGIN);
    }
  }
  return { cols: COLS, blocked };
}

export function isBlockedCell(g: NavGrid, c: number, r: number): boolean {
  if (c < 0 || r < 0 || c >= COLS || r >= COLS) return true;
  return g.blocked[at(c, r)] === 1;
}

/** 就近自由格（目标点在障碍里时往周围找） */
function nearestFree(g: NavGrid, c: number, r: number): [number, number] {
  if (!isBlockedCell(g, c, r)) return [c, r];
  for (let rad = 1; rad <= 8; rad++) {
    for (let dc = -rad; dc <= rad; dc++) {
      for (let dr = -rad; dr <= rad; dr++) {
        if (Math.abs(dc) !== rad && Math.abs(dr) !== rad) continue;
        if (!isBlockedCell(g, c + dc, r + dr)) return [c + dc, r + dr];
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

/** A*：二叉堆开表（世界 171² 格，线性扫描开表会太慢） */
function astar(g: NavGrid, sc: number, sr: number, tc: number, tr: number): Array<{ c: number; r: number }> {
  const heap: Node[] = [{ c: sc, r: sr, g: 0, f: 0 }];
  const push = (n: Node) => {
    heap.push(n);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p].f <= heap[i].f) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = (): Node | undefined => {
    if (!heap.length) return undefined;
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l].f < heap[m].f) m = l;
        if (r < heap.length && heap[r].f < heap[m].f) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  const seen = new Map<number, number>();
  const key = (c: number, r: number) => r * COLS + c;
  seen.set(key(sc, sr), 0);
  let expanded = 0;

  for (;;) {
    const cur = pop();
    if (!cur) break;
    if (cur.c === tc && cur.r === tr) {
      const path: Array<{ c: number; r: number }> = [];
      let n: Node | undefined = cur;
      while (n) {
        path.push({ c: n.c, r: n.r });
        n = n.parent;
      }
      return path.reverse();
    }
    if (++expanded > 12000) break; // 兜底：搜太久就放弃
    for (const [dc, dr, cost] of [
      [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
      [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414],
    ] as Array<[number, number, number]>) {
      const nc = cur.c + dc;
      const nr = cur.r + dr;
      if (isBlockedCell(g, nc, nr)) continue;
      if (dc !== 0 && dr !== 0 && (isBlockedCell(g, cur.c + dc, cur.r) || isBlockedCell(g, cur.c, cur.r + dr))) continue;
      const ng = cur.g + cost;
      const k = key(nc, nr);
      const prev = seen.get(k);
      if (prev !== undefined && prev <= ng) continue;
      seen.set(k, ng);
      const h = Math.hypot(tc - nc, tr - nr);
      push({ c: nc, r: nr, g: ng, f: ng + h, parent: cur });
    }
  }
  return [];
}

/** 视线检查（平滑用） */
function los(g: NavGrid, x0: number, z0: number, x1: number, z1: number): boolean {
  const dist = Math.hypot(x1 - x0, z1 - z0);
  const steps = Math.ceil(dist / (CELL * 0.5));
  for (let i = 0; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps;
    const z = z0 + ((z1 - z0) * i) / steps;
    const [c, r] = worldToCell(x, z);
    if (isBlockedCell(g, c, r)) return false;
  }
  return true;
}

/** 求路径（世界坐标点序列）；无路返回空数组 */
export function findPath2D(g: NavGrid, x0: number, z0: number, x1: number, z1: number): Array<{ x: number; z: number }> {
  const [sc, sr] = nearestFree(g, ...worldToCell(x0, z0));
  const [tc, tr] = nearestFree(g, ...worldToCell(x1, z1));
  const cells = astar(g, sc, sr, tc, tr);
  if (!cells.length) return [];
  const world = cells.map(({ c, r }) => cellToWorld(c, r));
  world[0] = { x: x0, z: z0 };
  world[world.length - 1] = { x: x1, z: z1 };
  // 视线平滑
  const out: Array<{ x: number; z: number }> = [world[0]];
  let i = 0;
  while (i < world.length - 1) {
    let j = world.length - 1;
    while (j > i + 1 && !los(g, world[i].x, world[i].z, world[j].x, world[j].z)) j--;
    out.push(world[j]);
    i = j;
  }
  return out;
}
