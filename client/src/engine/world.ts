// 客户端世界状态：高度图（含 mods）+ 道具索引 + 碰撞
import { heightAt as baseHeightAt, WORLD_SEED, WATER_LEVEL, WorldMeta, WorldObject, TerrainMod, PlayerInfo, isPropCollidable, isBuildingKind } from "@world3d/shared";
import { requestPlace, requestRemove } from "../net/socket";

interface RemoteAvatar {
  group: unknown;
  target: { x: number; y: number; z: number; rotY: number };
  info: PlayerInfo;
}

class ClientWorld {
  meta: WorldMeta | null = null;
  mods = new Map<string, TerrainMod>();
  objects = new Map<string, WorldObject>();
  remotes = new Map<string, RemoteAvatar>();

  /** 道具增删回调（props 渲染层注册） */
  onObjectAdded: (o: WorldObject, animate: boolean) => void = () => {};
  onObjectRemoved: (id: string) => void = () => {};
  onModsChanged: () => void = () => {};

  configure(meta: WorldMeta) {
    this.meta = meta;
  }

  seedObjects(objects: WorldObject[], mods: TerrainMod[]) {
    this.objects.clear();
    this.mods.clear();
    for (const o of objects) this.objects.set(o.id, o);
    for (const m of mods) this.mods.set(m.id, m);
    this.siteCache.clear(); // 换世界：宅基地基座高度全部失效
  }

  /** 原始地表高度：噪声基底 - 池塘凹陷（不含建筑宅基地整平） */
  private heightRaw(x: number, z: number): number {
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

  /** 建筑宅基地整平过渡带宽度（脚印外的斜坡衔接距离） */
  private static readonly SITE_MARGIN = 2.6;
  /** 宅基地基座高度缓存（原始地形下的脚印最低点），mods 变化时清空 */
  private siteCache = new Map<string, number>();

  /** 建筑半脚印尺寸（house/tower/shop 用 params.w/d，office 固定 8×6） */
  private siteHalf(o: WorldObject): { hx: number; hz: number } {
    const s = o.scale || 1;
    const dims: Record<string, { lo: number; hi: number; def: number }> = {
      house: { lo: 3, hi: 11, def: 5 },
      tower: { lo: 6, hi: 10, def: 7 },
      shop: { lo: 5, hi: 8, def: 6 },
    };
    const t = dims[o.kind];
    if (t) {
      return {
        hx: (Math.min(t.hi, Math.max(t.lo, Number(o.params?.w ?? t.def))) / 2) * s,
        hz: (Math.min(t.hi, Math.max(t.lo, Number(o.params?.d ?? t.def))) / 2) * s,
      };
    }
    return { hx: 4.1 * s, hz: 3.1 * s }; // 办公楼主体 8×6
  }

  /** 建筑基座高度：脚印范围内原始地形的最低采样点（略下沉保证与地面咬合） */
  siteLevelOf(o: WorldObject): number {
    const cached = this.siteCache.get(o.id);
    if (cached !== undefined) return cached;
    const { hx, hz } = this.siteHalf(o);
    let min = Infinity;
    const N = 6;
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        const x = o.x - hx + (2 * hx * i) / N;
        const z = o.z - hz + (2 * hz * j) / N;
        min = Math.min(min, this.heightRaw(x, z));
      }
    }
    const level = min - 0.12;
    this.siteCache.set(o.id, level);
    return level;
  }

  /** 最终地表高度：原始地形 + 建筑宅基地整平（脚印内拉平到基座高度，四周平滑过渡） */
  heightAt(x: number, z: number): number {
    let h = this.heightRaw(x, z);
    for (const o of this.objects.values()) {
      if (!isBuildingKind(o.kind)) continue;
      // 粗筛：离建筑中心太远的直接跳过（脚印+过渡带的最大外接半径）
      const { hx, hz } = this.siteHalf(o);
      const reach = Math.hypot(hx, hz) + 2.6;
      const dx0 = x - o.x;
      const dz0 = z - o.z;
      if (dx0 * dx0 + dz0 * dz0 > reach * reach) continue;
      // 旋转到建筑局部坐标系（世界 → 局部 = R(-rotY)）
      const c = Math.cos(o.rotY);
      const s = Math.sin(o.rotY);
      const lx = dx0 * c - dz0 * s;
      const lz = dx0 * s + dz0 * c;
      const qx = Math.max(0, Math.abs(lx) - hx);
      const qz = Math.max(0, Math.abs(lz) - hz);
      const d = Math.hypot(qx, qz);
      if (d >= 2.6) continue;
      const t = 1 - d / 2.6;
      const k = t * t * (3 - 2 * t); // smoothstep：边缘平滑过渡
      h += (this.siteLevelOf(o) - h) * k;
    }
    return h;
  }

  isLand(x: number, z: number): boolean {
    return this.heightAt(x, z) > WATER_LEVEL + 0.25;
  }

  /** 行走表面高度 */
  surfaceY(x: number, z: number): number {
    return this.heightAt(x, z);
  }

  /** 行走阻挡：边界/深水/道具碰撞 */
  blockedAt(x: number, z: number): boolean {
    const meta = this.meta;
    const size = meta?.size ?? 256;
    if (x < 1.2 || z < 1.2 || x > size - 1.2 || z > size - 1.2) return true;
    if (!this.isLand(x, z)) return true;
    // 道具碰撞（圆形近似）
    for (const o of this.objects.values()) {
      const cr = isPropCollidable(o.kind);
      if (cr <= 0) continue;
      const scale = o.scale || 1;
      const r = cr * scale * 0.8;
      if (Math.hypot(o.x - x, o.z - z) < r + 0.32) return true;
    }
    return false;
  }

  /** 手搓放置（走服务端权威校验） */
  placeProp(kind: string, variant: string, x: number, z: number, rotY: number, cb?: (ok: boolean, reason?: string) => void) {
    requestPlace({ kind, variant, x, z, rotY }, cb);
  }

  removeProp(id: string, cb?: (ok: boolean, reason?: string) => void) {
    requestRemove(id, cb);
  }

  applyPlaced(o: WorldObject) {
    this.objects.set(o.id, o);
    this.onObjectAdded(o, true);
  }

  applyRemoved(id: string) {
    this.objects.delete(id);
    this.onObjectRemoved(id);
  }

  applySculpt(mod: TerrainMod) {
    this.mods.set(mod.id, mod);
    this.siteCache.clear(); // 地形改造（挖池塘等）会改变原始高度，基座高度重新计算
    this.onModsChanged();
  }

  // ---------- 远端玩家 ----------
  onSnapshot(players: PlayerInfo[]) {
    for (const p of players) {
      const r = this.remotes.get(p.id);
      if (r) {
        r.target = { x: p.x, y: p.y, z: p.z, rotY: p.rotY };
        r.info = p;
      }
    }
  }

  addRemote(p: PlayerInfo) {
    if (this.remotes.has(p.id)) return;
    this.remoteFactory?.(p);
  }

  /** 已存在则原地更新（同 id 复活：服务端复用条目再广播 player:join，兴趣半径外的分身也靠它翻转离线态） */
  upsertRemote(p: PlayerInfo) {
    const r = this.remotes.get(p.id);
    if (!r) {
      this.addRemote(p);
      return;
    }
    r.target = { x: p.x, y: p.y, z: p.z, rotY: p.rotY };
    r.info = p;
  }

  removeRemote(id: string) {
    this.remoteRemover?.(id);
    this.remotes.delete(id);
  }

  /** 进出房间时清空远程玩家（房间内外坐标不同步，需按空间重播种） */
  clearRemotes() {
    for (const id of [...this.remotes.keys()]) this.removeRemote(id);
  }

  remoteFactory: ((p: PlayerInfo) => void) | null = null;
  remoteRemover: ((id: string) => void) | null = null;

  onHello: () => void = () => {};
}

export const clientWorld = new ClientWorld();
