import { PlayerInfo, MoveInput } from "@world3d/shared";
import { randomUUID } from "node:crypto";

// 在线玩家表 + 10Hz 快照广播（兴趣半径 48 格）
// 玩家断线后条目保留（online=false，小人原地驻留）；同身份再上线从原位置「复活」
const INTEREST_RADIUS = 48;
const TICK_MS = 100;
/** 离线驻留时长：超过后惰性清理（join 时触发），防内存无限涨 */
const OFFLINE_TTL_MS = 48 * 60 * 60 * 1000;

const PALETTE = ["#e8618c", "#5b8def", "#3aa981", "#d08a2e", "#9a6ee2", "#cf5b5b", "#38a2b5", "#b8860b"];

export interface Player extends PlayerInfo {
  socketId: string;
  lastMove: number;
  /** 当前所在房间（null = 户外大世界）。房间内坐标为房间局部坐标 */
  roomId: string | null;
  /** 进房前的户外位置，离开房间时恢复 */
  outdoor: { x: number; y: number; z: number; rotY: number } | null;
  /** 登录账号 id（游客为 null）。造物归属用 u:<userId>，跨会话稳定 */
  userId: string | null;
  /** 游客持久身份（客户端 localStorage），断线重连凭它复活 */
  guestId: string | null;
  /** false = 已断线，小人原地驻留 */
  online: boolean;
  offlineAt: number;
}

export interface JoinResult {
  player: Player;
  /** true = 同身份离线条目复活（位置/颜色保留），调用方用「回来了」文案 */
  resumed: boolean;
}

export class Presence {
  players = new Map<string, Player>();
  private io: { emit: (ev: string, p: unknown) => void } | null = null;
  private toSocket: (socketId: string, event: string, payload: unknown) => void = () => {};
  private timer: NodeJS.Timeout | null = null;

  attach(io: { emit: (ev: string, p: unknown) => void }, toSocket: (socketId: string, ev: string, p: unknown) => void) {
    this.io = io;
    this.toSocket = toSocket;
    if (!this.timer) {
      this.timer = setInterval(() => this.tick(), TICK_MS);
    }
  }

  /**
   * 加入世界：同身份（登录 userId 或游客 guestId）有离线条目则复活——
   * 保留 id/颜色/位置/房间外记忆，只换 socket 与名字；否则新建。
   */
  join(
    name: string,
    socketId: string,
    spawn: { x: number; y: number; z: number },
    userId: string | null = null,
    guestId: string | null = null
  ): JoinResult {
    this.pruneOffline();
    const key = userId ?? (guestId ? `g:${guestId}` : null);
    if (key) {
      for (const p of this.players.values()) {
        if (p.online) continue;
        const same = userId ? p.userId === userId : !!p.guestId && p.guestId === guestId;
        if (!same) continue;
        // 复活：恢复在线，位置保持原地
        p.name = name;
        p.socketId = socketId;
        p.online = true;
        p.offlineAt = 0;
        if (userId) p.guestId = guestId ?? p.guestId;
        return { player: p, resumed: true };
      }
    }
    const id = randomUUID().slice(0, 8);
    const color = PALETTE[this.players.size % PALETTE.length];
    const p: Player = {
      id,
      name,
      color,
      x: spawn.x,
      y: spawn.y,
      z: spawn.z,
      rotY: 0,
      anim: "idle",
      socketId,
      lastMove: Date.now(),
      roomId: null,
      outdoor: null,
      userId,
      guestId,
      online: true,
      offlineAt: 0,
    };
    this.players.set(id, p);
    return { player: p, resumed: false };
  }

  /** 按 userId 找在线玩家（封禁踢线用；离线驻留的踢不着也无需踢） */
  findByUserId(userId: string): Player | null {
    return [...this.players.values()].find((p) => p.userId === userId && p.online) ?? null;
  }

  /** 离线驻留（不删条目）：房间内先请出房间（恢复户外位置），房间列表/编排器自然解除引用 */
  markOffline(id: string): Player | null {
    const p = this.players.get(id);
    if (!p || !p.online) return p ?? null;
    if (p.roomId) this.setRoom(id, null);
    p.online = false;
    p.offlineAt = Date.now();
    return p;
  }

  /** 惰性清理：离线超过 TTL 的条目删除 */
  private pruneOffline() {
    const now = Date.now();
    for (const [id, p] of this.players) {
      if (!p.online && p.offlineAt > 0 && now - p.offlineAt > OFFLINE_TTL_MS) this.players.delete(id);
    }
  }

  get(id: string): Player | null {
    return this.players.get(id) ?? null;
  }

  updateMove(id: string, mv: MoveInput) {
    const p = this.players.get(id);
    if (!p) return;
    p.x = mv.x;
    p.y = mv.y;
    p.z = mv.z;
    p.rotY = mv.rotY;
    p.anim = mv.anim;
    p.lastMove = Date.now();
  }

  publicInfo(p: Player): PlayerInfo {
    return { id: p.id, name: p.name, color: p.color, x: p.x, y: p.y, z: p.z, rotY: p.rotY, anim: p.anim, online: p.online };
  }

  /** 进/出房间：roomId 为 null 表示回到户外（恢复 outdoor 位置） */
  setRoom(id: string, roomId: string | null, spawn?: { x: number; y: number; z: number }): Player | null {
    const p = this.players.get(id);
    if (!p) return null;
    if (roomId) {
      p.outdoor = { x: p.x, y: p.y, z: p.z, rotY: p.rotY };
      p.roomId = roomId;
      if (spawn) {
        p.x = spawn.x;
        p.y = spawn.y;
        p.z = spawn.z;
        p.rotY = spawn.z >= 0 ? Math.PI : 0; // 面向房间内
      }
    } else {
      p.roomId = null;
      if (p.outdoor) {
        p.x = p.outdoor.x;
        p.y = p.outdoor.y;
        p.z = p.outdoor.z;
        p.rotY = p.outdoor.rotY;
      }
      p.outdoor = null;
    }
    return p;
  }

  playersInRoom(roomId: string): Player[] {
    return [...this.players.values()].filter((p) => p.roomId === roomId && p.online);
  }

  private tick() {
    if (!this.io) return;
    const all = [...this.players.values()];
    for (const p of all) {
      if (!p.online) continue; // 离线驻留的小人没有 socket，不收快照
      // 兴趣过滤：必须同处一个空间（同为户外或同房间）且距离足够近；离线驻留的玩家照常广播（带上 online:false）
      const nearby = all.filter(
        (o) => o.id !== p.id && o.roomId === p.roomId && Math.hypot(o.x - p.x, o.z - p.z) <= INTEREST_RADIUS
      );
      const snap = {
        t: Date.now(),
        players: nearby.map((o) => this.publicInfo(o)),
      };
      this.toSocket(p.socketId, "snapshot", snap);
    }
  }
}
