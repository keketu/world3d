// 低模世界内核：高度图（噪声基底+雕塑）+ 道具对象（含创建者溯源）+ 简单碰撞
import { randomUUID } from "node:crypto";
import {
  heightAt as baseHeightAt,
  WATER_LEVEL,
  WORLD_SEED,
  WorldMeta,
  WorldObject,
  TerrainMod,
  PROP_KINDS,
} from "@world3d/shared";

export interface TerrainModRow extends TerrainMod {
  params?: Record<string, unknown>;
}

export type WorldObjectRow = WorldObject & { params: Record<string, unknown> };

interface PropCollision {
  x: number;
  z: number;
  r: number;
}

/** 各道具的占地半径（碰撞与间距检查用） */
const FOOTPRINT: Record<string, number> = {
  tree: 1.2,
  flower: 0.9,
  house: 3.4,
  fence: 4.5,
  path: 1.2,
  pond: 0,
};

export class World {
  size = 256;
  meta: WorldMeta = { size: this.size, seed: WORLD_SEED, waterLevel: WATER_LEVEL };
  mods = new Map<string, TerrainModRow>();
  objects = new Map<string, WorldObjectRow>();

  /** 最终地表高度：噪声基底 - 雕塑凹陷 */
  heightAt(x: number, z: number): number {
    let h = baseHeightAt(x, z, WORLD_SEED);
    for (const m of this.mods.values()) {
      if (m.type !== "pond") continue;
      const d = Math.hypot(x - m.x, z - m.z);
      if (d < m.r * 1.15) {
        const k = d <= m.r ? 1 - (d / m.r) * 0.35 : Math.max(0, 1 - (d - m.r) / (m.r * 0.15)) * 0.65;
        h -= m.depth * k;
      }
    }
    return h;
  }

  inBounds(x: number, z: number): boolean {
    return x >= 1 && x < this.size - 1 && z >= 1 && z < this.size - 1;
  }

  /** 是否陆地（可放置/可行走） */
  isLand(x: number, z: number): boolean {
    return this.heightAt(x, z) > WATER_LEVEL + 0.25;
  }

  /** 道具碰撞圆列表（行走避让用） */
  collidersNear(x: number, z: number, radius: number): PropCollision[] {
    const out: PropCollision[] = [];
    for (const o of this.objects.values()) {
      const fr = FOOTPRINT[o.kind] ?? 1;
      if (fr <= 0) continue;
      if (Math.hypot(o.x - x, o.z - z) < radius + fr + 2) {
        out.push({ x: o.x, z: o.z, r: fr });
      }
    }
    return out;
  }

  /** 行走碰撞检测：新位置是否被道具挡住 */
  blockedAt(x: number, z: number, selfY: number): boolean {
    if (!this.inBounds(x, z)) return true;
    if (!this.isLand(x, z)) return true; // 不走进水里
    for (const c of this.collidersNear(x, z, 0.35)) {
      if (Math.hypot(c.x - x, c.z - z) < c.r + 0.3) return true;
    }
    return false;
  }

  /** 放置校验：边界/水域/与其他道具的最小间距 */
  validatePlacement(kind: string, x: number, z: number): { ok: boolean; reason?: string } {
    if (!this.inBounds(x, z)) return { ok: false, reason: "超出世界边界" };
    if (!this.isLand(x, z)) return { ok: false, reason: "不能放在水里" };
    const fr = FOOTPRINT[kind] ?? 1;
    for (const o of this.objects.values()) {
      const ofr = FOOTPRINT[o.kind] ?? 1;
      const need = kind === "path" || o.kind === "path" ? 0.2 : (fr + ofr) * 0.72;
      if (Math.hypot(o.x - x, o.z - z) < need) return { ok: false, reason: "离其他造物太近了" };
    }
    return { ok: true };
  }

  addObject(o: Omit<WorldObjectRow, "id">, params?: Record<string, unknown>): WorldObjectRow {
    const row: WorldObjectRow = { ...o, id: randomUUID(), params: params ?? {} };
    this.objects.set(row.id, row);
    return row;
  }

  removeObject(id: string): WorldObjectRow | null {
    const o = this.objects.get(id);
    this.objects.delete(id);
    return o ?? null;
  }

  /** 清除半径内的所有道具（AI 清空指令） */
  clearRadius(x: number, z: number, r: number, by: string, byName: string): WorldObjectRow[] {
    const removed: WorldObjectRow[] = [];
    for (const o of [...this.objects.values()]) {
      if (Math.hypot(o.x - x, o.z - z) <= r) {
        this.objects.delete(o.id);
        removed.push(o);
      }
    }
    void by;
    void byName;
    return removed;
  }

  addPondMod(x: number, z: number, r: number, depth: number, by: string): TerrainModRow {
    const mod: TerrainModRow = { id: randomUUID(), type: "pond", x, z, r, depth, by };
    this.mods.set(mod.id, mod);
    return mod;
  }

  findSpawn(): { x: number; y: number; z: number } {
    for (let r = 0; r < 40; r++) {
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2 + r;
        const x = Math.floor(this.size / 2 + Math.cos(a) * (5 + r * 0.9));
        const z = Math.floor(this.size / 2 + Math.sin(a) * (5 + r * 0.9));
        if (this.isLand(x, z) && !this.blockedAt(x + 0.5, z + 0.5, this.heightAt(x, z))) {
          return { x: x + 0.5, y: this.heightAt(x, z), z: z + 0.5 };
        }
      }
    }
    return { x: this.size / 2, y: 14, z: this.size / 2 };
  }

  publicMeta(): WorldMeta {
    return { ...this.meta };
  }

  void_(v: unknown) {
    void v;
  }

  static propCollisionRadius(kind: string) {
    return PROP_KINDS[kind]?.collideR ?? 1;
  }
}
