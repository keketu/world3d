// 城市生活：沿路网行驶的汽车（看红绿灯、礼让行人、跟车）+ 沿人行道和广场散步的居民
// 纯客户端氛围层：不进服务端、不参与玩家碰撞判定；进屋时随 propGroup 一起隐藏
import * as THREE from "three";
import { ROAD_LINES, mulberry32, WORLD_SEED } from "@world3d/shared";
import { createAvatar, compactAvatar, animateAvatar, Avatar } from "../avatar";
import { mergeParts } from "../mergeParts";
import * as Kit from "./townKit";
import type { TownPlan } from "./townPlan";
import { clientWorld } from "../../engine/world";

/** 车道中心距路中心 */
const LANE = 1.6;
/** 停止线距路口中心（斑马线之外） */
const STOP_LINE = 6.0;
/** 车头到车中心 */
const CAR_FRONT = 2.1;

export interface TownLife {
  group: THREE.Group;
  /** people = 玩家位置：车会礼让 */
  update(dt: number, time: number, phase: { ew: boolean; ns: boolean }, people: Array<{ x: number; z: number }>): void;
  stats: { cars: number; peds: number; loopShapes?: number[] };
  /** 调试：车辆与居民位置采样 */
  sample(): { cars: Array<{ x: number; z: number; v: number; rot: number }>; peds: Array<{ x: number; z: number }> };
  /** 附近居民（玩家绕人用）：返回半径内最近的一位 */
  pedNear(x: number, z: number, r: number): { x: number; z: number } | null;
}

interface Loop {
  pts: Array<[number, number]>;
  seg: number[];
  total: number;
}

function makeLoop(pts: Array<[number, number]>): Loop {
  const seg: number[] = [];
  let total = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    seg.push(len);
    total += len;
  }
  return { pts, seg, total };
}

interface PathPoint {
  x: number;
  z: number;
  dx: number;
  dz: number;
  i: number;
}

function loopPoint(lp: Loop, s: number, out: PathPoint): PathPoint {
  let t = ((s % lp.total) + lp.total) % lp.total;
  for (let i = 0; i < lp.pts.length; i++) {
    if (t <= lp.seg[i] || i === lp.pts.length - 1) {
      const a = lp.pts[i];
      const b = lp.pts[(i + 1) % lp.pts.length];
      const len = Math.max(1e-6, lp.seg[i]);
      out.x = a[0] + ((b[0] - a[0]) * t) / len;
      out.z = a[1] + ((b[1] - a[1]) * t) / len;
      out.dx = (b[0] - a[0]) / len;
      out.dz = (b[1] - a[1]) / len;
      out.i = i;
      return out;
    }
    t -= lp.seg[i];
  }
  return out;
}

/**
 * 绕一块被道路围住的区域顺时针行驶（右侧通行，车道靠街区一侧）。
 * 转角走圆弧（直线段 + 90° 圆弧相切）——直角转弯会让车看起来在平移。
 * 圆弧半径自适应：逐档试到不压建筑为止。
 */
function ringLoop(xa: number, xb: number, za: number, zb: number, blocked?: (x: number, z: number) => boolean, lane: 1 | -1 = 1): Loop {
  // lane=+1 外扩（顺时针右手通行的车道，靠近路的外侧）；lane=-1 内缩（对向车道）
  const x0 = xa - LANE * lane;
  const x1 = xb + LANE * lane;
  const z0 = za - LANE * lane;
  const z1 = zb + LANE * lane;
  // 顺时针四个转角：(x1,z1) → (x0,z1) → (x0,z0) → (x1,z0)
  // 顺时针四个转角：南边往 -x → 西边往 -z → 北边往 +x → 东边往 +z
  // 每个转角是 90° 圆弧（与两条直路相切）：圆心在角内侧 r 处，角度沿行进方向递增
  // 顺时针角序（外扩车道）：西南→西北→东北→东南；逆时针（内缩对向车道）把角序反过来
  const CW = [
    { cx: x0, cz: z1, a0: Math.PI / 2, a1: Math.PI, inX: 1, inZ: -1 },
    { cx: x0, cz: z0, a0: Math.PI, a1: Math.PI * 1.5, inX: 1, inZ: 1 },
    { cx: x1, cz: z0, a0: Math.PI * 1.5, a1: Math.PI * 2, inX: -1, inZ: 1 },
    { cx: x1, cz: z1, a0: 0, a1: Math.PI / 2, inX: -1, inZ: -1 },
  ];
  const corners =
    lane === 1
      ? CW
      : [
          { cx: x1, cz: z1, a0: Math.PI * 1.5, a1: Math.PI * 2, inX: -1, inZ: -1 },
          { cx: x1, cz: z0, a0: Math.PI, a1: Math.PI * 1.5, inX: -1, inZ: 1 },
          { cx: x0, cz: z0, a0: Math.PI / 2, a1: Math.PI, inX: 1, inZ: 1 },
          { cx: x0, cz: z1, a0: 0, a1: Math.PI / 2, inX: 1, inZ: -1 },
        ];
  const radii = [9, 7, 5, 3.5, 2.5];
  for (const r of radii) {
    const pts: Array<[number, number]> = [];
    let ok = true;
    for (const c of corners) {
      const ccx = c.cx + c.inX * r;
      const ccz = c.cz + c.inZ * r;
      for (let i = 0; i <= 7; i++) {
        const a = c.a0 + (c.a1 - c.a0) * (i / 7);
        const px = ccx + Math.cos(a) * r;
        const pz = ccz + Math.sin(a) * r;
        if (blocked && blocked(px, pz)) {
          ok = false;
          break;
        }
        pts.push([px, pz]);
      }
      if (!ok) break;
    }
    if (ok && pts.length) return makeLoop(pts);
  }
  // 都不行就用直角环（退回旧行为）
  const fb = lane === 1
    ? [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]
    : [[x0, z1], [x1, z1], [x1, z0], [x0, z0]];
  return makeLoop(fb as Array<[number, number]>);
}

export function createTownLife(plan: TownPlan, opts: { crowd: number; heightAt: (x: number, z: number) => number }): TownLife {
  const rng = mulberry32(WORLD_SEED ^ 0x6c696665); // "life"
  const group = new THREE.Group();
  const carMat = new THREE.MeshLambertMaterial({ vertexColors: true });

  const geoCache = new Map<string, THREE.BufferGeometry>();
  const vehicleGeo = (key: string, build: (p: Kit.Parts) => void) => {
    let geo = geoCache.get(key);
    if (!geo) {
      const parts: Kit.Parts = [];
      build(parts);
      geo = mergeParts(parts);
      geoCache.set(key, geo);
    }
    return geo;
  };

  // ---------- 车辆：9 个街区各绕一圈 + 一辆公交沿外环 ----------
  const solidAt = (x: number, z: number) => clientWorld.blockedAt(x, z);
  // 每个街区两条车道：外扩（顺时针右手通行）+ 内缩（对向车道，逆时针）——同一条路上双向分流
  const cwLoops: Loop[] = [];
  const ccwLoops: Loop[] = [];
  /** 诊断：环道点位（32 = 圆弧版，4 = 降级直角） */
  const loopShapes: number[] = [];
  for (let bi = 1; bi <= 3; bi++) {
    for (let bj = 1; bj <= 3; bj++) {
      const xa = ROAD_LINES[bi - 1];
      const xb = ROAD_LINES[bi];
      const za = ROAD_LINES[bj - 1];
      const zb = ROAD_LINES[bj];
      const l1 = ringLoop(xa, xb, za, zb, solidAt, 1);
      const l2 = ringLoop(xa, xb, za, zb, solidAt, -1);
      cwLoops.push(l1);
      ccwLoops.push(l2);
      loopShapes.push(l1.pts.length, l2.pts.length);
    }
  }
  interface Car {
    mesh: THREE.Mesh;
    loop: Loop;
    s: number;
    v: number;
    vmax: number;
    /** 当前朝向（平滑插值，不瞬间跳变） */
    heading: number;
    /** 行驶方向：1 = 顺时针，-1 = 逆时针（对向车流） */
    dir: 1 | -1;
  }
  const cars: Car[] = [];
  const addCar = (loop: Loop, s: number, geo: THREE.BufferGeometry, vmax: number, dir: 1 | -1 = 1) => {
    const mesh = new THREE.Mesh(geo, carMat);
    mesh.castShadow = true;
    group.add(mesh);
    const p0 = loopPoint(loop, s, { x: 0, z: 0, dx: 0, dz: 0, i: 0 });
    cars.push({ mesh, loop, s: s % loop.total, v: 0, vmax, heading: Math.atan2(-p0.dz * dir, p0.dx * dir), dir });
  };
  cwLoops.forEach((lp, i) => {
    const color = i % Kit.CAR_COLORS.length;
    const variant = rng() < 0.32 ? 1 : 0;
    const geo = vehicleGeo(`car-${color}-${variant}`, (p) => Kit.car(p, Kit.CAR_COLORS[color], variant));
    addCar(lp, rng() * lp.total, geo, 4.6 + rng() * 1.6, 1);
    // 对向车道也放一辆（部分街区）
    if (i % 2 === 0) {
      const c2 = (i + 3) % Kit.CAR_COLORS.length;
      const g2 = vehicleGeo(`car-${c2}-${variant}`, (p) => Kit.car(p, Kit.CAR_COLORS[c2], variant));
      addCar(ccwLoops[i], rng() * ccwLoops[i].total, g2, (4.6 + rng() * 1.6) * 0.92, -1);
    }
  });
  // 外环公交（沿最外圈道路）
  addCar(ringLoop(ROAD_LINES[0], ROAD_LINES[3], ROAD_LINES[0], ROAD_LINES[3], solidAt, 1), 40, vehicleGeo("bus", (p) => Kit.bus(p, 0x53a8c8)), 5.6);

  // ---------- 居民 ----------
  interface Ped {
    av: Avatar;
    x: number;
    z: number;
    heading: number;
    speed: number;
    loop?: Loop;
    s?: number;
    dir: 1 | -1;
    target?: [number, number];
    wait: number;
    phase: number;
  }
  const peds: Ped[] = [];
  const nLoop = Math.max(1, Math.round(opts.crowd * 0.55));
  for (let i = 0; i < opts.crowd; i++) {
    const av = createAvatar(`居民${i}${rng() > 0.5 ? "子" : "太"}`, "#000000");
    compactAvatar(av);
    group.add(av.group);
    const ped: Ped = {
      av,
      x: 128,
      z: 128,
      heading: 0,
      speed: 1.25 + rng() * 0.6,
      dir: rng() < 0.5 ? 1 : -1,
      wait: rng() * 2,
      phase: rng() * 10,
    };
    if (i < nLoop && plan.loops.length) {
      // plan.loops 是原始点数组，转成带里程的环道
      ped.loop = makeLoop(plan.loops[i % plan.loops.length]);
      ped.s = rng() * ped.loop.total;
    } else {
      const spot = plan.plazaSpots[Math.floor(rng() * Math.max(1, plan.plazaSpots.length))] ?? [128, 128];
      ped.x = spot[0];
      ped.z = spot[1];
    }
    peds.push(ped);
  }

  const pt: PathPoint = { x: 0, z: 0, dx: 0, dz: 0, i: 0 };
  const turn = (cur: number, target: number, maxStep: number) => {
    const d = ((target - cur + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    return cur + Math.max(-maxStep, Math.min(maxStep, d));
  };

  return {
    group,
    stats: { cars: cars.length, peds: peds.length, loopShapes },
    pedNear(x, z, r) {
      let best: { x: number; z: number } | null = null;
      let bd = r * r;
      for (const p of peds) {
        const dx = p.x - x;
        const dz = p.z - z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bd) {
          bd = d2;
          best = { x: p.x, z: p.z };
        }
      }
      return best;
    },
    sample() {
      return {
        cars: cars.map((c) => ({
          x: Math.round(c.mesh.position.x * 10) / 10,
          z: Math.round(c.mesh.position.z * 10) / 10,
          v: Math.round(c.v * 100) / 100,
          /** 真实渲染朝向（弧度）——用于验证转向是否平滑 */
          rot: Math.round(c.mesh.rotation.y * 1000) / 1000,
        })),
        peds: peds.map((p) => ({ x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10 })),
      };
    },
    update(dt, time, phase, people) {
      // --- 车：红绿灯 → 礼让行人/居民 → 跟车 → 限速 ---
      for (const c of cars) {
        loopPoint(c.loop, c.s, pt);
        const alongX = Math.abs(pt.dx) > 0.5;
        const axis = alongX ? "ew" : "ns";
        const posAlong = alongX ? pt.x : pt.z;
        const dir = (alongX ? pt.dx : pt.dz) * c.dir;
        let target = c.vmax;
        let brakeDist = Infinity;
        if (!(axis === "ew" ? phase.ew : phase.ns)) {
          const end = c.loop.pts[(pt.i + 1) % c.loop.pts.length][alongX ? 0 : 1];
          for (const L of ROAD_LINES) {
            const d = (L - posAlong) * dir;
            if (d > STOP_LINE + 0.3 && d <= (end - posAlong) * dir + 0.5) brakeDist = Math.min(brakeDist, d - STOP_LINE - CAR_FRONT);
          }
        }
        const avoid = (qx: number, qz: number) => {
          const rx = qx - pt.x;
          const rz = qz - pt.z;
          const fwd = rx * pt.dx + rz * pt.dz;
          const lat = Math.abs(rx * pt.dz - rz * pt.dx);
          if (fwd > 0.4 && fwd < 5.2 && lat < 1.7) brakeDist = Math.min(brakeDist, fwd - CAR_FRONT - 1.3);
        };
        for (const q of people) avoid(q.x, q.z);
        for (const ped of peds) avoid(ped.x, ped.z);
        for (const o of cars) {
          if (o === c || o.loop !== c.loop) continue;
          if (o.dir === c.dir) {
            const gap = ((o.s - c.s + c.loop.total) % c.loop.total) - 4.6;
            if (gap > 0 && gap < 10) brakeDist = Math.min(brakeDist, gap - 3.2);
          }
        }
        if (brakeDist < Infinity) {
          if (brakeDist < 0.25) target = 0;
          else target = Math.min(target, Math.sqrt(2 * 3.2 * Math.max(0, brakeDist)));
        }
        c.v += Math.max(-8 * dt, Math.min(2.6 * dt, target - c.v));
        if (c.v < 0.02 && target === 0) c.v = 0;
        c.s += c.v * dt * c.dir;
        loopPoint(c.loop, c.s, pt);
        // 朝向平滑：朝路径方向渐变（瞬间跳变看着像滑行）
        // 注意：车模型的车头沿局部 +x，而 three 的 yaw 约定是 +z，所以要用 atan2(-dz, dx)（否则差 90° → 侧着平移）
        const want = Math.atan2(-pt.dz * c.dir, pt.dx * c.dir);
        let diff = ((want - c.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        c.heading += diff * Math.min(1, dt * 7);
        c.mesh.rotation.y = c.heading;
        c.mesh.position.set(pt.x, opts.heightAt(pt.x, pt.z), pt.z);
      }

      // --- 居民：环道散步 / 广场游走，偶尔驻足 ---
      for (const ped of peds) {
        let moving = false;
        if (ped.wait > 0) {
          ped.wait -= dt;
        } else if (ped.loop && ped.s !== undefined) {
          ped.s += ped.speed * ped.dir * dt;
          loopPoint(ped.loop, ped.s, pt);
          ped.x = pt.x;
          ped.z = pt.z;
          if (rng() < dt * 0.03) ped.wait = 1.5 + rng() * 3.5;
          moving = true;
          const want = ped.dir === 1 ? Math.atan2(pt.dx, pt.dz) : Math.atan2(-pt.dx, -pt.dz);
          ped.heading = turn(ped.heading, want, 9 * dt);
        } else if (plan.plazaSpots.length > 1) {
          if (!ped.target) {
            for (let k = 0; k < 8 && !ped.target; k++) {
              const t = plan.plazaSpots[Math.floor(rng() * plan.plazaSpots.length)];
              if (plan.occ.clearLine(ped.x, ped.z, t[0], t[1], 0.4) && Math.hypot(t[0] - ped.x, t[1] - ped.z) > 6) ped.target = t;
            }
            if (!ped.target) ped.wait = 1;
          }
          if (ped.target) {
            const dx = ped.target[0] - ped.x;
            const dz = ped.target[1] - ped.z;
            const d = Math.hypot(dx, dz);
            if (d < 0.3) {
              ped.target = undefined;
              ped.wait = 1.5 + rng() * 4;
            } else {
              const step = Math.min(d, ped.speed * dt);
              ped.x += (dx / d) * step;
              ped.z += (dz / d) * step;
              ped.heading = turn(ped.heading, Math.atan2(dx, dz), 9 * dt);
              moving = true;
            }
          }
        }
        ped.av.group.position.set(ped.x, opts.heightAt(ped.x, ped.z), ped.z);
        ped.av.group.rotation.y = ped.heading;
        animateAvatar(ped.av, moving ? "walk" : "idle", time + ped.phase);
      }
    },
  };
}
