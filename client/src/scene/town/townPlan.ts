// 城市陈设布局（纯数据，不含渲染）：由确定性的路网 + 现有造物，算出街景设施、停车泊位、门前铺装和居民散步路线
// 客户端据此合批建模（townDressing），地形贴图据此画铺装和泊位线（terrain）
import {
  ROAD_LINES,
  ROAD_HALF,
  SIDEWALK_W,
  EDGE_GRASS,
  CITY_SIZE,
  isBuildingKind,
  buildingSize,
  mulberry32,
  WORLD_SEED,
  type WorldObject,
} from "@world3d/shared";
import { ColliderGrid, type Collider } from "../../engine/colliderGrid";

export type ItemKind =
  | "cherry" | "round" | "birch" | "pine" | "bush" | "grate"
  | "bench" | "bollard" | "bin" | "planter" | "hydrant" | "mailbox" | "bikeRack" | "busStop"
  | "trafficEW" | "trafficNS" | "parkedCar"
  | "fountain" | "parasol" | "kiosk" | "clockTower" | "pergola" | "flowerBed" | "hedge" | "parkLamp" | "pond" | "playground" | "picnic";

export interface TownItem {
  kind: ItemKind;
  x: number;
  z: number;
  rotY: number;
  scale: number;
  /** 配色/种类变体 */
  tone: number;
  variant: number;
  /** 长度（绿篱）/ 池塘半径 */
  len: number;
  sx: number;
  sz: number;
}

export interface ParkingBay {
  x: number;
  z: number;
  rotY: number;
  len: number;
  wid: number;
}

export interface Paving {
  x: number;
  z: number;
  hw: number;
  hd: number;
  rotY: number;
  /** 0 = 门前小广场，1 = 步道 */
  tone: number;
}

export interface TownPlan {
  items: TownItem[];
  colliders: Collider[];
  bays: ParkingBay[];
  paving: Paving[];
  /** 居民散步路线：闭合折线（街区人行道环 / 公园环道） */
  loops: Array<Array<[number, number]>>;
  /** 广场自由漫步的落脚点 */
  plazaSpots: Array<[number, number]>;
  /** 全部占位（服务端造物 + 陈设 + 门口净空）：运行时供居民寻路、落点预览查询 */
  occ: ColliderGrid;
}

/** 居民行走线（距路中心）：人行道 4.5~6.7，家具都靠外侧 5.75 以外 */
const WALK_OFF = ROAD_HALF + 0.6;
/** 每条主干道的行道树树种（西→东 / 北→南） */
const TREE_SPECIES = ["round", "birch", "cherry", "pine"] as const;
const SYSTEM = new Set(["system", "system-city"]);

export function planTown(objects: WorldObject[]): TownPlan {
  const rng = mulberry32(WORLD_SEED ^ 0x746f776e); // "town"
  const items: TownItem[] = [];
  const colliders: Collider[] = [];
  const bays: ParkingBay[] = [];
  const paving: Paving[] = [];
  const loops: Array<Array<[number, number]>> = [];
  const plazaSpots: Array<[number, number]> = [];
  const occ = new ColliderGrid();

  const item = (kind: ItemKind, x: number, z: number, rotY = 0, extra: Partial<TownItem> = {}): TownItem => ({
    kind, x, z, rotY, scale: 1, tone: Math.floor(rng() * 3), variant: 0, len: 0, sx: 0, sz: 0, ...extra,
  });

  const circle = (r: number): Omit<Collider, "x" | "z"> => ({ r, hw: 0, hd: 0, rotY: 0 });
  const rect = (hw: number, hd: number, rotY: number): Omit<Collider, "x" | "z"> => ({ r: 0, hw, hd, rotY });

  // ---------- 现有造物 → 占位（真实占地；门口另留净空） ----------
  const doorDist = (o: WorldObject): number => {
    const s = buildingSize(o.kind, o.params);
    return o.kind === "office" ? Number(o.params?.doorDist ?? 4.6) : o.kind === "tower" ? s.d / 2 + 2.2 : o.kind === "shop" ? s.d / 2 + 0.9 : s.d / 2 + 0.5;
  };
  /** 建筑门口（进门触发点）：街具不让占；门旁自家配的花箱/车架除外（place 的 allowDoor） */
  const doorZones: Array<{ x: number; z: number }> = [];
  for (const o of objects) {
    if (o.kind === "path" || o.kind === "flower" || o.kind === "pond") continue;
    if (isBuildingKind(o.kind)) {
      const s = buildingSize(o.kind, o.params);
      // 写字楼外壳外还有 0.8m 裙房
      const pad = o.kind === "tower" ? 1.0 : 0.4;
      occ.add({ ...rect(s.w / 2 + pad, s.d / 2 + pad, o.rotY), x: o.x, z: o.z });
      doorZones.push({ x: o.x + Math.sin(o.rotY) * doorDist(o), z: o.z + Math.cos(o.rotY) * doorDist(o) });
    } else if (o.kind === "fence") {
      const half = Math.min(30, Math.max(4, Number(o.params?.len ?? 7))) / 2 + 0.3;
      occ.add({ ...rect(half, half, o.rotY), x: o.x, z: o.z });
    } else {
      occ.add({ ...circle(o.kind === "tree" ? 0.35 : 0.3), x: o.x, z: o.z });
    }
  }

  /** 落位：先查占位（陈设包络 + gap + 门口净空），通过才登记碰撞体。colAt 指定碰撞体中心（默认同陈设原点） */
  const place = (it: TownItem, col: Omit<Collider, "x" | "z"> | null, gap = 0, colAt?: [number, number], allowDoor = false): boolean => {
    const cx = colAt ? colAt[0] : it.x;
    const cz = colAt ? colAt[1] : it.z;
    const need = (col ? (col.r > 0 ? col.r : Math.hypot(col.hw, col.hd)) : 0) + gap;
    if (occ.hit(cx, cz, need)) return false;
    if (!allowDoor && doorZones.some((d) => Math.hypot(d.x - cx, d.z - cz) < 2.4 + need)) return false;
    items.push(it);
    if (col) {
      const c = { ...col, x: cx, z: cz };
      colliders.push(c);
      occ.add(c);
    }
    return true;
  };

  // ---------- 街道：遍历每条路的每一侧 ----------
  // P(off, t) → 世界坐标；axis 0 = 沿 z 的路（x=L），axis 1 = 沿 x 的路（z=L）；off 从路中心向外
  const nearCross = (t: number, d: number) => ROAD_LINES.some((X) => Math.abs(t - X) < d);
  /** 家具正面朝车道（−s 方向） */
  const faceRoad = (axis: number, s: number) => (axis === 0 ? -s * Math.PI / 2 : s > 0 ? Math.PI : 0);

  type Side = { L: number; axis: number; s: number };
  const sides: Side[] = [];
  ROAD_LINES.forEach((L) => {
    for (const axis of [0, 1]) for (const s of [-1, 1]) sides.push({ L, axis, s });
  });
  const P = (sd: Side, off: number, t: number): [number, number] =>
    sd.axis === 0 ? [sd.L + sd.s * off, t] : [t, sd.L + sd.s * off];

  // 公交站：先占位，行道树/长椅/停车都避让
  for (const [axis, L, s, t0] of [[0, 160, 1, 118], [1, 160, 1, 200], [0, 96, -1, 128], [1, 96, 1, 52]] as Array<[number, number, number, number]>) {
    const sd: Side = { L, axis, s };
    for (const dt of [0, -9, 9, -18, 18]) {
      const [x, z] = P(sd, 6.15, t0 + dt);
      if (place(item("busStop", x, z, faceRoad(axis, s)), rect(1.55, 0.65, faceRoad(axis, s)), 0.5)) break;
    }
  }

  // 行道树（+ 树池）：间距 ~10.5m，路口和斑马线附近留空
  ROAD_LINES.forEach((L, li) => {
    for (const axis of [0, 1]) for (const s of [-1, 1]) {
      const sd: Side = { L, axis, s };
      const phase = rng() * 5;
      for (let t = 12 + phase; t < CITY_SIZE - 10; t += 10.5) {
        if (nearCross(t, 9.5)) continue;
        const [x, z] = P(sd, 6.2, t + (rng() - 0.5) * 1.6);
        const species = rng() < 0.84 ? TREE_SPECIES[li] : TREE_SPECIES[Math.floor(rng() * 4)];
        const it = item(species, x, z, rng() * Math.PI * 2, { scale: 0.95 + rng() * 0.3 });
        if (place(it, circle(0.32), 1.2)) items.push(item("grate", x, z));
      }
    }
  });

  // 长椅（朝街）+ 垃圾桶；消防栓 / 邮筒 / 花箱
  for (const sd of sides) {
    for (let t = 17; t < CITY_SIZE - 12; t += 27) {
      if (nearCross(t, 13)) continue;
      const [x, z] = P(sd, 6.15, t);
      const rotY = faceRoad(sd.axis, sd.s);
      if (place(item("bench", x, z, rotY), rect(0.9, 0.4, rotY), 0.5)) {
        if (rng() < 0.6) {
          const [bx, bz] = P(sd, 6.15, t + 1.55);
          place(item("bin", bx, bz), circle(0.3), 0.4);
        }
      }
    }
    for (let t = 24 + rng() * 10; t < CITY_SIZE - 14; t += 38 + rng() * 22) {
      if (nearCross(t, 12)) continue;
      const [x, z] = P(sd, 6.1, t);
      const roll = rng();
      const kind: ItemKind = roll < 0.38 ? "hydrant" : roll < 0.6 ? "mailbox" : "planter";
      place(item(kind, x, z, faceRoad(sd.axis, sd.s), { variant: Math.floor(rng() * 2) }), circle(0.55), 0.5);
    }
  }

  // 路口：斑马线两端的护柱 + 四角的红绿灯
  for (const Lx of ROAD_LINES) {
    for (const Lz of ROAD_LINES) {
      for (const s of [-1, 1]) {
        for (const e of [-1, 1]) {
          for (const d of [-0.55, 0.55]) {
            const bollards: Array<[number, number]> = [
              [Lx + e * (ROAD_HALF + 0.22), Lz + s * 4.8 + d],
              [Lx + s * 4.8 + d, Lz + e * (ROAD_HALF + 0.22)],
            ];
            for (const [x, z] of bollards) {
              if (!occ.hit(x, z, 0.25)) place(item("bollard", x, z), circle(0.12));
            }
          }
        }
      }
      // 横臂伸向路口、灯面朝来车：SE/NW 管东西向，NE/SW 管南北向
      const masts: Array<[number, number, number, ItemKind]> = [
        [1, 1, Math.PI / 2, "trafficEW"],
        [-1, -1, -Math.PI / 2, "trafficEW"],
        [1, -1, Math.PI, "trafficNS"],
        [-1, 1, 0, "trafficNS"],
      ];
      for (const [sx, sz, rotY, kind] of masts) {
        place(item(kind, Lx + sx * 6.25, Lz + sz * 6.25, rotY), circle(0.16), 0.25);
      }
    }
  }

  // 路边停车：车头朝该侧车道的通行方向，泊位画白线
  {
    const edges = [EDGE_GRASS, ...ROAD_LINES, CITY_SIZE - EDGE_GRASS];
    const segs: Array<[number, number]> = [];
    for (let i = 0; i < edges.length - 1; i++) {
      segs.push([edges[i] + (i > 0 ? ROAD_HALF : 0), edges[i + 1] - (i < edges.length - 2 ? ROAD_HALF : 0)]);
    }
    const COUNT = [0, 0, 1, 0, 1, 0, 2]; // 路边停车稀疏：多数路段空着，少数停 1~2 辆
    for (const sd of sides) {
      for (const [a, b] of segs) {
        const maxN = Math.min(3, Math.floor((b - a - 2) / 9));
        const n = Math.min(maxN, COUNT[Math.floor(rng() * COUNT.length)]);
        const start = a + 2 + rng() * Math.max(0, b - a - 4 - n * 9);
        const rotY = sd.axis === 0 ? (sd.s > 0 ? Math.PI / 2 : -Math.PI / 2) : sd.s > 0 ? 0 : Math.PI;
        for (let j = 0; j < n; j++) {
          const [x, z] = P(sd, 3.5, start + 4.5 + j * 9);
          const it = item("parkedCar", x, z, rotY, { tone: Math.floor(rng() * 10), variant: rng() < 0.3 ? 1 : 0 });
          // 泊位线与车同位（画进地形贴图），车停在线内
          if (place(it, rect(2.05, 0.95, rotY), 0.3)) bays.push({ x, z, rotY, len: 5.4, wid: 2.4 });
        }
      }
    }
  }

  // ---------- 系统建筑周边：门前铺装/步道、两侧绿篱、花箱、自行车架；商铺加咖啡外摆 ----------
  for (const o of objects) {
    if (!isBuildingKind(o.kind) || !SYSTEM.has(o.creatorId)) continue;
    const s = buildingSize(o.kind, o.params) as { w: number; d: number };
    const f = { x: Math.sin(o.rotY), z: Math.cos(o.rotY) }; // 正面朝向
    const r = { x: Math.cos(o.rotY), z: -Math.sin(o.rotY) }; // 站在门前面向建筑时的右手边
    const dd = doorDist(o);
    const D = { x: o.x + f.x * dd, z: o.z + f.z * dd };
    paving.push({ x: o.x + f.x * (s.d / 2 + 1.7), z: o.z + f.z * (s.d / 2 + 1.7), hw: s.w / 2 + 1.3, hd: 1.7, rotY: o.rotY, tone: 0 });
    // 正对着最近那条路时，铺一条步道接到人行道
    const axisX = Math.abs(f.x) > 0.99;
    const dist = ROAD_LINES.map((L) => (axisX ? (f.x > 0 ? L - o.x : o.x - L) : f.z > 0 ? L - o.z : o.z - L)).filter((v) => v > 0);
    const toRoad = Math.min(...dist);
    if (toRoad - ROAD_HALF - SIDEWALK_W > s.d / 2 + 4.5) {
      const a = s.d / 2 + 3.2;
      const b = toRoad - ROAD_HALF - SIDEWALK_W + 0.4;
      paving.push({
        x: o.x + f.x * (a + b) / 2,
        z: o.z + f.z * (a + b) / 2,
        hw: 1.1,
        hd: (b - a) / 2,
        rotY: axisX ? (f.x > 0 ? Math.PI / 2 : -Math.PI / 2) : f.z > 0 ? 0 : Math.PI,
        tone: 1,
      });
    }
    // 两侧绿篱：从后墙留 0.5m 起，到前墙留 1.7m（不挡门口）
    const len = s.d - 2.2;
    if (len > 2.5) {
      const off = s.w / 2 + (o.kind === "tower" ? 1.35 : 0.9);
      for (const side of [-1, 1]) {
        const cx = o.x + r.x * side * off - f.x * 0.6;
        const cz = o.z + r.z * side * off - f.z * 0.6;
        if (occ.clearLine(cx - f.x * len / 2, cz - f.z * len / 2, cx + f.x * len / 2, cz + f.z * len / 2, 0.55)) {
          place(item("hedge", cx, cz, o.rotY, { len }), rect(0.3, len / 2, o.rotY));
        }
      }
    }
    for (const side of [-1, 1]) {
      place(
        item("planter", D.x + r.x * side * 1.75 + f.x * 0.3, D.z + r.z * side * 1.75 + f.z * 0.3, o.rotY, { variant: 1 }),
        rect(0.65, 0.3, o.rotY),
        0.3,
        undefined,
        true
      );
    }
    if (o.kind === "shop") {
      for (const side of [-1, 1]) {
        place(item("parasol", D.x + r.x * side * 4.9 + f.x * 0.9, D.z + r.z * side * 4.9 + f.z * 0.9), circle(1.15), 0.35, undefined, true);
      }
    } else {
      const side = rng() < 0.5 ? -1 : 1;
      place(item("bikeRack", D.x + r.x * side * 3.6 + f.x * 0.5, D.z + r.z * side * 3.6 + f.z * 0.5, o.rotY), rect(0.9, 1.3, o.rotY), 0.4, undefined, true);
    }
  }

  // ---------- 广场（2-2 / 2-3）：贴图里外圈是草坪环，中间 34×34 的石板核心 + 十字步道通向四边 ----------
  // 北广场：喷泉居中，长椅环绕
  const F = { x: 128, z: 128 };
  place(item("fountain", F.x, F.z), circle(4.5));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.26;
    const x = F.x + Math.sin(a) * 7.6;
    const z = F.z + Math.cos(a) * 7.6;
    const rotY = Math.atan2(F.x - x, F.z - z);
    place(item("bench", x, z, rotY), rect(0.9, 0.4, rotY), 0.4);
  }
  place(item("pergola", 141, 115, Math.PI / 4), rect(2.6, 1.4, Math.PI / 4), 0.8);
  place(item("pergola", 115, 141, Math.PI / 4), rect(2.6, 1.4, Math.PI / 4), 0.8);

  // 南广场：售货亭 + 外摆、钟楼、凉亭
  place(item("kiosk", 134, 195, Math.PI), rect(2.0, 1.5, Math.PI), 0.6);
  for (const [x, z] of [[127.5, 189], [127.5, 197], [141, 189], [141, 197]] as Array<[number, number]>) {
    place(item("parasol", x, z, rng() * 6), circle(1.15), 0.35);
  }
  place(item("clockTower", 115, 180), rect(1.1, 1.1, 0), 1.2);
  place(item("pergola", 114, 203, 0.2), rect(2.6, 1.4, 0.2), 0.8);

  for (const cz of [128, 192]) {
    // 四条步道口两侧各一张长椅（面向步道），园灯立在核心四角
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as Array<[number, number]>) {
      for (const side of [-1, 1]) {
        const x = 128 + dx * 15.2 + dz * side * 2.9;
        const z = cz + dz * 15.2 + dx * side * 2.9;
        const rotY = Math.atan2(-dz * side, -dx * side); // 朝向步道中线
        place(item("bench", x, z, rotY), rect(0.9, 0.4, rotY), 0.4);
      }
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      place(item("parkLamp", 128 + sx * 11.5, cz + sz * 11.5), circle(0.2), 0.8);
    }
    // 草坪环：北广场以樱花为主，南广场混种；避开石板核心和十字步道
    const cherryChance = cz === 128 ? 0.78 : 0.4;
    for (let i = 0; i < 52; i++) {
      const dx = (rng() - 0.5) * 47;
      const dz = (rng() - 0.5) * 47;
      if (Math.abs(dx) < 19.6 && Math.abs(dz) < 19.6) continue;
      if (Math.abs(dx) < 3.4 || Math.abs(dz) < 3.4) continue;
      const kind: ItemKind = rng() < cherryChance ? "cherry" : "round";
      place(item(kind, 128 + dx, cz + dz, rng() * 6, { scale: 1.05 + rng() * 0.35 }), circle(0.35), 1.5);
    }
    // 草坪环四角的花坛（在两条步道之间）
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      place(item("flowerBed", 128 + sx * 15.5, cz + sz * 21.8, 0), rect(1.3, 0.65, 0), 0.7);
      place(item("flowerBed", 128 + sx * 21.8, cz + sz * 15.5, Math.PI / 2), rect(0.65, 1.3, Math.PI / 2), 0.7);
    }
  }

  // ---------- 公园（3-3）：池塘、游乐场、环道长椅、凉亭、野餐桌，其余种成密林 ----------
  const C = { x: 192, z: 192 };
  // 池塘：候选位里挑第一个周围没树的；都不空就放宽间距再找一轮
  outer: for (const gap of [1, 0.15]) {
    for (const [px, pz] of [[177, 206], [207, 207], [177, 178]] as Array<[number, number]>) {
      if (place(item("pond", px, pz, 0, { sx: 5.2, sz: 4 }), circle(5.5), gap)) break outer;
    }
  }
  for (const [gx, gz] of [[205, 179], [179, 179], [205, 206]] as Array<[number, number]>) {
    if (place(item("playground", gx, gz), rect(5, 2.2, 0), 1, [gx + 3, gz - 1])) break;
  }
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3 + 0.5;
    const x = C.x + Math.sin(a) * 13.6;
    const z = C.z + Math.cos(a) * 13.6;
    const rotY = Math.atan2(C.x - x, C.z - z);
    place(item("bench", x, z, rotY), rect(0.9, 0.4, rotY), 0.5);
  }
  for (const [x, z, rotY] of [[179, 179, 0.4], [211, 199, -1.2], [192, 213, 0]] as Array<[number, number, number]>) {
    place(item("pergola", x, z, rotY), rect(2.6, 1.4, rotY), 0.8);
  }
  for (const [x, z, rotY] of [[206, 205, 0.3], [200, 210, 1.2], [170, 192, Math.PI / 2]] as Array<[number, number, number]>) {
    place(item("picnic", x, z, rotY), rect(1.0, 0.9, rotY), 0.8);
  }
  for (const [x, z, rotY] of [[192, 172, 0], [170, 210, Math.PI / 2], [214, 186, Math.PI / 2]] as Array<[number, number, number]>) {
    place(item("flowerBed", x, z, rotY), rect(rotY ? 0.65 : 1.3, rotY ? 1.3 : 0.65, rotY), 0.8);
  }
  // 园灯都在环道（r=12）以外
  for (const [x, z] of [[192, 176], [176, 192], [208, 192], [192, 208], [176, 176], [208, 208]] as Array<[number, number]>) {
    place(item("parkLamp", x, z), circle(0.2), 0.8);
  }
  // 密林：公园块内随机撒树和灌木，避开环道（r 10~14.4）和已占位
  const wood = (x: number, z: number, big: number) => {
    const species: ItemKind[] = ["round", "cherry", "birch", "pine"];
    if (rng() < big) return item(species[Math.floor(rng() * 4)], x, z, rng() * 6, { scale: 0.95 + rng() * 0.45 });
    return item("bush", x, z, rng() * 6, { scale: 0.8 + rng() * 0.6, variant: rng() < 0.4 ? 1 : 0 });
  };
  for (let i = 0; i < 150; i++) {
    const x = 168.5 + rng() * 47;
    const z = 168.5 + rng() * 47;
    const dc = Math.hypot(x - C.x, z - C.z);
    if (dc > 9.6 && dc < 14.6) continue;
    const it = wood(x, z, 0.55);
    place(it, it.kind === "bush" ? null : circle(0.32), it.kind === "bush" ? 0.9 : 1.5);
  }
  // 外环绿带：种成围绕全城的林带
  for (let i = 0; i < 640; i++) {
    const x = 3 + rng() * (CITY_SIZE - 6);
    const z = 3 + rng() * (CITY_SIZE - 6);
    const outer = 32 - ROAD_HALF - SIDEWALK_W - 0.3;
    if (x > outer && x < CITY_SIZE - outer && z > outer && z < CITY_SIZE - outer) continue;
    const it = wood(x, z, 0.6);
    place(it, it.kind === "bush" ? null : circle(0.32), it.kind === "bush" ? 0.9 : 1.5);
  }

  // ---------- 居民路线：9 个街区的人行道环 + 公园环道 + 广场落脚点 ----------
  for (let bi = 1; bi <= 3; bi++) {
    for (let bj = 1; bj <= 3; bj++) {
      const x0 = ROAD_LINES[bi - 1] + WALK_OFF;
      const x1 = ROAD_LINES[bi] - WALK_OFF;
      const z0 = ROAD_LINES[bj - 1] + WALK_OFF;
      const z1 = ROAD_LINES[bj] - WALK_OFF;
      const pts: Array<[number, number]> = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
      if (occ.clearLoop(pts, 0.25)) loops.push(pts);
    }
  }
  const ring: Array<[number, number]> = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    ring.push([C.x + Math.sin(a) * 12, C.z + Math.cos(a) * 12]);
  }
  if (occ.clearLoop(ring, 0.3)) loops.push(ring);
  // 广场落脚点：只落在石板核心里（外圈是草坪，由陈设占着）
  for (let i = 0; i < 260 && plazaSpots.length < 44; i++) {
    const x = 128 + (rng() - 0.5) * 32;
    const z = (rng() < 0.5 ? 128 : 192) + (rng() - 0.5) * 32;
    if (!occ.hit(x, z, 0.7)) plazaSpots.push([x, z]);
  }

  return { items, colliders, bays, paving, loops, plazaSpots, occ };
}

let cached: TownPlan | null = null;
/** 全城陈设布局（首次按现有造物计算，之后不变：城市路网是确定性的） */
export function getTownPlan(objects: Iterable<WorldObject>): TownPlan {
  if (!cached) cached = planTown([...objects]);
  return cached;
}
