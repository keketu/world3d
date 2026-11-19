// 后台实时通道：socket.io-client 连 /admin 命名空间
import { io, Socket } from "socket.io-client";
import type { PlayerRow } from "@world3d/shared";

export interface AdminEvent {
  kind: string;
  actor: string;
  actorId: string;
  text: string;
  ts: number;
}

export interface AdminLogLine {
  id?: number;
  ts: number;
  level: string;
  text: string;
}

type Listener<T> = (payload: T) => void;

class Realtime {
  private sock: Socket | null = null;
  private eventListeners = new Set<Listener<AdminEvent>>();
  private logListeners = new Set<Listener<AdminLogLine>>();
  private statsListeners = new Set<Listener<{ online: number; ts: number }>>();
  private playerListeners = new Set<Listener<PlayerRow[]>>();
  private connected = false;

  connect(token: string) {
    if (this.sock) this.sock.disconnect();
    this.sock = io("/admin", {
      transports: ["websocket", "polling"],
      auth: { token },
      path: "/socket.io",
    });
    this.sock.on("connect", () => {
      this.connected = true;
    });
    this.sock.on("disconnect", () => {
      this.connected = false;
    });
    this.sock.on("connect_error", () => {
      this.connected = false;
    });
    this.sock.on("admin:event", (p: AdminEvent) => this.eventListeners.forEach((fn) => fn(p)));
    this.sock.on("admin:log", (p: AdminLogLine) => this.logListeners.forEach((fn) => fn(p)));
    this.sock.on("admin:stats", (p: { online: number; ts: number }) => this.statsListeners.forEach((fn) => fn(p)));
    this.sock.on("admin:players", (p: PlayerRow[]) => this.playerListeners.forEach((fn) => fn(p)));
  }

  disconnect() {
    this.sock?.disconnect();
    this.sock = null;
    this.connected = false;
  }

  get isConnected() {
    return this.connected;
  }

  onEvent(fn: Listener<AdminEvent>) {
    this.eventListeners.add(fn);
    return () => {
      this.eventListeners.delete(fn);
    };
  }
  onLog(fn: Listener<AdminLogLine>) {
    this.logListeners.add(fn);
    return () => {
      this.logListeners.delete(fn);
    };
  }
  onStats(fn: Listener<{ online: number; ts: number }>) {
    this.statsListeners.add(fn);
    return () => {
      this.statsListeners.delete(fn);
    };
  }
  onPlayers(fn: Listener<PlayerRow[]>) {
    this.playerListeners.add(fn);
    return () => {
      this.playerListeners.delete(fn);
    };
  }
}

export const realtime = new Realtime();
