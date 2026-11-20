// 城市布局（阳光都市）：全域路网+街区的确定性平面，两端共享——客户端画地形贴图，服务端落楼
// 坐标约定与噪声地形一致：世界 256×256，原点左上
import { WORLD_SEED, mulberry32 } from "./noise.js";

export const CITY_SIZE = 256;
/** 主干道中心线坐标（间距 64m） */
export const ROAD_LINES = [32, 96, 160, 224];
/** 路面半宽（总宽 9m） */
export const ROAD_HALF = 4.5;
/** 街区内侧人行道带宽 */
export const SIDEWALK_W = 2.2;
/** 地图最外圈草绿过渡带宽度 */
export const EDGE_GRASS = 6;

export type CityZone = "road" | "sidewalk" | "lot" | "park" | "plaza" | "grass";

/** 块列/行编号：0 与 4 = 城市外环绿带，1..3 = 街区 */
function bandIndex(v: number): number {
  return v < 32 ? 0 : v < 96 ? 1 : v < 160 ? 2 : v < 224 ? 3 : 4;
}

export function blockId(x: number, z: number): string {
  return `${bandIndex(x)}-${bandIndex(z)}`;
}

/** 街区中心坐标（含外环绿带块） */
export function blockCenter(b: number): number {
  if (b === 0) return 15;
  if (b === 4) return 241;
  return (ROAD_LINES[b - 1] + ROAD_LINES[b]) / 2;
}

// 广场块：出生点 + 办公楼所在的两块（不落楼，画广场铺装）
const PLAZA_BLOCKS = new Set(["2-2", "2-3"]);

// 公园块：从剩余街区中确定性挑 1 块
const PARK_BLOCKS: Set<string> = (() => {
  const candidates = ["1-1", "1-2", "1-3", "2-1", "3-1", "3-2", "3-3"];
  const rng = mulberry32(WORLD_SEED ^ 0x63697479); // "city"
  return new Set([candidates[Math.floor(rng() * candidates.length)]]);
})();

/** 公园块 id（boot 绿化与贴图共用） */
export const PARK_IDS = PARK_BLOCKS;

/** 距最近主干道中心线的轴距 */
function axisRoadDist(v: number): number {
  let d = Infinity;
  for (const L of ROAD_LINES) d = Math.min(d, Math.abs(v - L));
  return d;
}

/** 城市分区查询：道路 / 人行道 / 街区地块 / 公园 / 广场 / 外圈草绿 */
export function zoneAt(x: number, z: number): CityZone {
  if (x < EDGE_GRASS || z < EDGE_GRASS || x > CITY_SIZE - EDGE_GRASS || z > CITY_SIZE - EDGE_GRASS) return "grass";
  const dx = axisRoadDist(x);
  const dz = axisRoadDist(z);
  if (dx < ROAD_HALF || dz < ROAD_HALF) return "road";
  if (dx < ROAD_HALF + SIDEWALK_W || dz < ROAD_HALF + SIDEWALK_W) return "sidewalk";
  const id = blockId(x, z);
  if (PLAZA_BLOCKS.has(id)) return "plaza";
  if (PARK_BLOCKS.has(id)) return "park";
  // 外环绿带块（0/4 行列的内部）按公园处理
  if (id.startsWith("0-") || id.startsWith("4-") || id.endsWith("-0") || id.endsWith("-4")) return "park";
  return "lot";
}

/** 面向最近主干道的朝向（门的局部 +z 指向道路），用于建筑落位 */
export function faceRoad(x: number, z: number): number {
  let rot = 0;
  let best = Infinity;
  for (const L of ROAD_LINES) {
    const dx = L - x;
    if (Math.abs(dx) < best) {
      best = Math.abs(dx);
      rot = dx > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    const dz = L - z;
    if (Math.abs(dz) < best) {
      best = Math.abs(dz);
      rot = dz > 0 ? 0 : Math.PI;
    }
  }
  return rot;
}

export interface CityLot {
  id: string;
  kind: "tower" | "shop";
  x: number;
  z: number;
  rotY: number;
  /** 建议 variant（确定性随机）与层数 */
  variant: string;
  floors: number;
  /** 地名牌（如「北街西座写字楼」） */
  name: string;
}

const TOWER_VARIANTS = ["蓝玻璃", "暖白", "陶土红"];
const SHOP_VARIANTS = ["咖啡橙", "薄荷绿", "奶油黄"];

// ---------- 土地权：九州 = 内部街区 1..3×1..3，每州 2×2 象限共 4 块小地块 ----------

export interface PlotBounds {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface PlotInfo {
  plotId: string;
  /** 所属州 = 街区 blockId */
  state: string;
  bounds: PlotBounds;
}

/** 街区内部边界（去掉道路与人行道） */
function blockInner(b: number): [number, number] {
  return [ROAD_LINES[b - 1] + ROAD_HALF + SIDEWALK_W, ROAD_LINES[b] - ROAD_HALF - SIDEWALK_W];
}

/** 某坐标所在的九州小地块 id（如 1-1#00）；广场/公园/绿带/道路返回 null（公共区） */
export function plotIdAt(x: number, z: number): string | null {
  const ci = bandIndex(x);
  const cj = bandIndex(z);
  if (ci < 1 || ci > 3 || cj < 1 || cj > 3) return null;
  const state = `${ci}-${cj}`;
  if (PLAZA_BLOCKS.has(state) || PARK_BLOCKS.has(state)) return null;
  const [x0, x1] = blockInner(ci);
  const [z0, z1] = blockInner(cj);
  const qx = x < (x0 + x1) / 2 ? 0 : 1;
  const qz = z < (z0 + z1) / 2 ? 0 : 1;
  return `${state}#${qx}${qz}`;
}

/** 地块 id → 矩形边界 */
export function plotBounds(plotId: string): PlotBounds | null {
  const m = plotId.match(/^([1-3])-([1-3])#([01])([01])$/);
  if (!m) return null;
  const [x0, x1] = blockInner(Number(m[1]));
  const [z0, z1] = blockInner(Number(m[2]));
  const mx = (x0 + x1) / 2;
  const mz = (z0 + z1) / 2;
  const qx = Number(m[3]);
  const qz = Number(m[4]);
  return { x0: qx ? mx : x0, x1: qx ? x1 : mx, z0: qz ? mz : z0, z1: qz ? z1 : mz };
}

/** 全部可申请地块（24 块：6 州 × 4） */
export function listPlots(): PlotInfo[] {
  const out: PlotInfo[] = [];
  for (let ci = 1; ci <= 3; ci++) {
    for (let cj = 1; cj <= 3; cj++) {
      const state = `${ci}-${cj}`;
      if (PLAZA_BLOCKS.has(state) || PARK_BLOCKS.has(state)) continue;
      const [x0, x1] = blockInner(ci);
      const [z0, z1] = blockInner(cj);
      const mx = (x0 + x1) / 2;
      const mz = (z0 + z1) / 2;
      for (const [qx, qz] of [[0, 0], [1, 0], [0, 1], [1, 1]] as Array<[number, number]>) {
        out.push({ plotId: `${state}#${qx}${qz}`, state, bounds: { x0: qx ? mx : x0, x1: qx ? x1 : mx, z0: qz ? mz : z0, z1: qz ? z1 : mz } });
      }
    }
  }
  return out;
}

/**
 * 城市建筑落位表（确定性）：非广场/公园的 6 个街区里，
 * 3 块放写字楼（各 2 栋，块内左右分立），3 块放商铺（各 3 间，沿临街面排开）
 */
export function cityLots(): CityLot[] {
  const buildingBlocks = ["1-1", "1-2", "1-3", "2-1", "3-1", "3-2", "3-3"].filter((id) => !PARK_BLOCKS.has(id));
  const rng = mulberry32(WORLD_SEED ^ 0x6c6f7473); // "lots"
  // 洗牌后前 3 块放写字楼，后 3 块放商铺
  const shuffled = [...buildingBlocks];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const lots: CityLot[] = [];
  const colName = (b: number) => ["", "西", "中", "东", ""][b];
  const rowName = (b: number) => ["", "北", "中", "南", ""][b];
  const emit = (block: string, kind: "tower" | "shop", slots: Array<{ x: number; z: number }>) => {
    const [cs, rs] = block.split("-");
    const cx = blockCenter(Number(cs));
    const cz = blockCenter(Number(rs));
    for (const s of slots) {
      const x = s.x ?? cx;
      const z = s.z ?? cz;
      lots.push({
        id: `${block}-${kind}-${x.toFixed(0)}_${z.toFixed(0)}`,
        kind,
        x,
        z,
        rotY: faceRoad(x, z),
        variant: kind === "tower" ? TOWER_VARIANTS[Math.floor(rng() * TOWER_VARIANTS.length)] : SHOP_VARIANTS[Math.floor(rng() * SHOP_VARIANTS.length)],
        floors: 4 + Math.floor(rng() * 7), // 4..12 层
        name: `${rowName(Number(rs))}街${colName(Number(cs))}座${kind === "tower" ? "写字楼" : "商铺"}`,
      });
    }
  };
  shuffled.forEach((block, i) => {
    const [cs, rs] = block.split("-");
    const cx = blockCenter(Number(cs));
    const cz = blockCenter(Number(rs));
    if (i < 3) {
      // 写字楼：块内左右两栋
      emit(block, "tower", [{ x: cx - 12, z: cz }, { x: cx + 12, z: cz }]);
    } else {
      // 商铺：沿临街面（朝向更靠中央 128 的那侧）排 3 间
      const towardCenter = cz < 128 ? 1 : -1;
      emit(block, "shop", [
        { x: cx - 14, z: cz + towardCenter * 21 },
        { x: cx, z: cz + towardCenter * 21 },
        { x: cx + 14, z: cz + towardCenter * 21 },
      ]);
    }
  });
  return lots;
}
