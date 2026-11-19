import { PlayerInfo, MoveInput } from "@world3d/shared";
import { randomUUID } from "node:crypto";

// 在线玩家表 + 10Hz 快照广播（兴趣半径 48 格）
const INTEREST_RADIUS = 48;
const TICK_MS = 100;

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

  join(name: string, socketId: string, spawn: { x: number; y: number; z: number }, userId: string | null = null): Player {
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
    };
    this.players.set(id, p);
    return p;
  }

  /** 按 userId 找在线玩家（封禁踢线用） */
  findByUserId(userId: string): Player | null {
    return [...this.players.values()].find((p) => p.userId === userId) ?? null;
  }

  leave(id: string): Player | null {
    const p = this.players.get(id);
    this.players.delete(id);
    return p ?? null;
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
    return { id: p.id, name: p.name, color: p.color, x: p.x, y: p.y, z: p.z, rotY: p.rotY, anim: p.anim };
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
    return [...this.players.values()].filter((p) => p.roomId === roomId);
  }

  private tick() {
    if (!this.io) return;
    const all = [...this.players.values()];
    for (const p of all) {
      // 兴趣过滤：必须同处一个空间（同为户外或同房间）且距离足够近
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
