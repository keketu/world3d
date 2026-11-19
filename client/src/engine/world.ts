// 客户端世界状态：高度图（含 mods）+ 道具索引 + 碰撞
import { heightAt as baseHeightAt, WORLD_SEED, WATER_LEVEL, WorldMeta, WorldObject, TerrainMod, PlayerInfo, isPropCollidable } from "@world3d/shared";
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
  }

  /** 最终地表高度：噪声基底 - 池塘凹陷 */
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
