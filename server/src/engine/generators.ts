// 形状生成器：把 BuildPlan 转成道具摆放序列（服务端权威）
import { BuildPlan } from "./nlu.js";
import { World } from "./world.js";

export interface PropOp {
  kind: string;
  variant: string;
  x: number;
  z: number;
  rotY: number;
  scale?: number;
  params?: Record<string, unknown>;
}

export interface GenResult {
  ops: PropOp[];
  kind: string;
  variant: string;
  /** AI 施工队完工汇报 */
  summary: string;
  /** 标注质心 */
  cx: number;
  cz: number;
  /** 附带地形雕塑（挖池塘） */
  sculpture?: { x: number; z: number; r: number; depth: number };
  /** 清除的对象 id（清空指令） */
  removeIds?: string[];
}

const TREE_LABEL: Record<string, string> = {
  樱花: "樱花树",
  松: "松树",
  白桦: "白桦树",
  橡: "橡树",
  树: "橡树",
};

function layoutPoints(
  px: number,
  pz: number,
  count: number,
  layout: "line" | "circle" | "scatter",
  rotY = 0
): Array<{ x: number; z: number }> {
  const pts: Array<{ x: number; z: number }> = [];
  if (layout === "line") {
    const dx = Math.round(Math.sin(rotY));
    const dz = Math.round(Math.cos(rotY));
    for (let i = 1; i <= count; i++) pts.push({ x: px + dx * (i * 2.6), z: pz + dz * (i * 2.6) });
  } else if (layout === "circle") {
    const r = Math.max(3.5, Math.ceil(count / 1.6));
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      pts.push({ x: Math.round(px + Math.cos(a) * r), z: Math.round(pz + Math.sin(a) * r) });
    }
  } else {
    let tries = 0;
    while (pts.length < count && tries < count * 14) {
      tries++;
      const x = px + Math.floor((Math.random() - 0.5) * 15);
      const z = pz + Math.floor((Math.random() - 0.5) * 15);
      if (pts.some((p) => Math.hypot(p.x - x, p.z - z) < 3)) continue;
      pts.push({ x, z });
    }
  }
  return pts;
}


/** 在目标点附近螺旋搜索一个可放置的位置 */
function findNearbySpot(world: World, x: number, z: number, kind: string): { x: number; z: number } | null {
  for (let r = 0; r <= 10; r += 2.5) {
    const steps = r === 0 ? 1 : Math.ceil((Math.PI * 2 * r) / 2.5);
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const cx = Math.round((x + Math.cos(a) * r) * 10) / 10;
      const cz = Math.round((z + Math.sin(a) * r) * 10) / 10;
      if (world.validatePlacement(kind, cx, cz).ok) return { x: cx, z: cz };
    }
  }
  return null;
}

export function generate(
  world: World,
  plan: BuildPlan,
  px: number,
  pz: number,
  rotY = 0
): GenResult | null {
  const ops: PropOp[] = [];

  switch (plan.action) {
    case "tree": {
      const variant = plan.variant ?? "橡";
      const pts = layoutPoints(px, pz, plan.count ?? 1, plan.layout ?? "scatter", rotY);
      let planted = 0;
      for (const p of pts) {
        // 原点不行就在附近螺旋找空位，别直接放弃
        const spot = findNearbySpot(world, p.x, p.z, "tree");
        if (!spot) continue;
        ops.push({ kind: "tree", variant, x: spot.x, z: spot.z, rotY: Math.random() * Math.PI * 2, scale: 0.9 + Math.random() * 0.35 });
        planted++;
      }
      if (!planted) return null;
      const label = TREE_LABEL[variant] ?? "树";
      return {
        ops,
        kind: "tree",
        variant: label,
        cx: px,
        cz: pz,
        summary: `${planted} 棵${label}`,
      };
    }
    case "flower": {
      const variant = plan.variant === "mixed" ? "粉" : plan.variant ?? "粉";
      const count = plan.count ?? 5;
      const pts = layoutPoints(px, pz, Math.ceil(count / 2), plan.layout === "circle" ? "circle" : "scatter", rotY);
      let n = 0;
      for (const p of pts) {
        const spot = findNearbySpot(world, p.x, p.z, "flower");
        if (!spot) continue;
        ops.push({ kind: "flower", variant, x: spot.x, z: spot.z, rotY: Math.random() * Math.PI * 2, scale: 0.9 + Math.random() * 0.4 });
        n++;
      }
      if (!n) return null;
      return {
        ops,
        kind: "flower",
        variant: `${variant}花丛`,
        cx: px,
        cz: pz,
        summary: `${n} 丛${variant}色花丛`,
      };
    }
    case "house": {
      const spot = findNearbySpot(world, Math.round(px) + 5, Math.round(pz) + 5, "house");
      if (!spot) return null;
      const x = spot.x;
      const z = spot.z;
      ops.push({
        kind: "house",
        variant: plan.variant ?? "小木屋",
        x,
        z,
        rotY: -rotY,
        params: { w: plan.w ?? 5, d: plan.d ?? 5 },
      });
      return {
        ops,
        kind: "house",
        variant: plan.variant ?? "小木屋",
        cx: x,
        cz: z,
        summary: `一座${plan.variant ?? "小木屋"}（${plan.w ?? 5}×${plan.d ?? 5}，带门窗）`,
      };
    }
    case "tower": {
      const spot = findNearbySpot(world, Math.round(px) + 6, Math.round(pz) + 6, "tower");
      if (!spot) return null;
      ops.push({
        kind: "tower",
        variant: plan.variant ?? "蓝玻璃",
        x: spot.x,
        z: spot.z,
        rotY: -rotY,
        params: { w: plan.w ?? 8, d: plan.d ?? 8, f: plan.floors ?? 6 },
      });
      return {
        ops,
        kind: "tower",
        variant: plan.variant ?? "蓝玻璃",
        cx: spot.x,
        cz: spot.z,
        summary: `一栋${plan.variant ?? "蓝玻璃"}写字楼（${plan.w ?? 8}×${plan.d ?? 8}，${plan.floors ?? 6} 层）`,
      };
    }
    case "shop": {
      const spot = findNearbySpot(world, Math.round(px) + 5, Math.round(pz) + 5, "shop");
      if (!spot) return null;
      ops.push({
        kind: "shop",
        variant: plan.variant ?? "咖啡橙",
        x: spot.x,
        z: spot.z,
        rotY: -rotY,
        params: { w: plan.w ?? 6, d: plan.d ?? 6 },
      });
      return {
        ops,
        kind: "shop",
        variant: plan.variant ?? "咖啡橙",
        cx: spot.x,
        cz: spot.z,
        summary: `一间${plan.variant ?? "咖啡橙"}商铺（${plan.w ?? 6}×${plan.d ?? 6}，带雨棚和招牌）`,
      };
    }
    case "path": {
      const len = plan.len ?? 8;
      const variant = plan.variant ?? "石板路";
      const dx = Math.round(Math.sin(rotY));
      const dz = Math.round(Math.cos(rotY));
      const x0 = Math.round(px);
      const z0 = Math.round(pz);
      ops.push({
        kind: "path",
        variant,
        x: x0 + (dx * len) / 2,
        z: z0 + (dz * len) / 2,
        rotY,
        params: { len, dx, dz },
      });
      return {
        ops,
        kind: "path",
        variant,
        cx: x0 + (dx * len) / 2,
        cz: z0 + (dz * len) / 2,
        summary: `${len} 格${variant}`,
      };
    }
    case "fence": {
      const len = plan.len ?? 7;
      ops.push({
        kind: "fence",
        variant: "木",
        x: Math.round(px),
        z: Math.round(pz),
        rotY: 0,
        params: { len },
      });
      return {
        ops,
        kind: "fence",
        variant: "木围栏",
        cx: px,
        cz: pz,
        summary: `一段 ${len} 格的木围栏`,
      };
    }
    case "pond": {
      const r = plan.radius ?? 4;
      const x = Math.round(px) + r + 3;
      const z = Math.round(pz);
      if (!world.inBounds(x, z)) return null;
      ops.push({ kind: "pond", variant: "池塘", x, z, rotY: 0, params: { r } });
      return {
        ops,
        kind: "pond",
        variant: "池塘",
        cx: x,
        cz: z,
        sculpture: { x, z, r, depth: Math.min(4.5, world.heightAt(x, z) - 4.5 > 2 ? 4.5 : world.heightAt(x, z) - 4.5) },
        summary: `一个半径 ${r} 的池塘`,
      };
    }
    case "clear": {
      const r = plan.radius ?? 5;
      const removed = world.clearRadius(px, pz, r, "", "");
      return {
        ops: [],
        kind: "cleared",
        variant: "清空区域",
        cx: px,
        cz: pz,
        removeIds: removed.map((o) => o.id),
        summary: `清除了 ${removed.length} 件造物，地面已恢复`,
      };
    }
  }
  return null;
}
