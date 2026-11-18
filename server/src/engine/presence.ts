import { PlayerInfo, MoveInput } from "@world3d/shared";
import { randomUUID } from "node:crypto";

// 在线玩家表 + 10Hz 快照广播（兴趣半径 48 格）
const INTEREST_RADIUS = 48;
const TICK_MS = 100;

const PALETTE = ["#e8618c", "#5b8def", "#3aa981", "#d08a2e", "#9a6ee2", "#cf5b5b", "#38a2b5", "#b8860b"];

export interface Player extends PlayerInfo {
  socketId: string;
  lastMove: number;
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

  join(name: string, socketId: string, spawn: { x: number; y: number; z: number }): Player {
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
    };
    this.players.set(id, p);
    return p;
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

  private tick() {
    if (!this.io) return;
    const all = [...this.players.values()];
    for (const p of all) {
      const nearby = all.filter((o) => o.id !== p.id && Math.hypot(o.x - p.x, o.z - p.z) <= INTEREST_RADIUS);
      const snap = {
        t: Date.now(),
        players: nearby.map((o) => this.publicInfo(o)),
      };
      this.toSocket(p.socketId, "snapshot", snap);
    }
  }
}
