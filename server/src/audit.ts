// 后台审计与事件流：管理操作留痕、世界事件流、服务器日志捕获、在线趋势回放
import type { Db } from "./db.js";
import type { OnlinePoint } from "@world3d/shared";

export type AdminPush = (event: string, payload: unknown) => void;

export class Audit {
  private db: Db;
  /** 推送给后台连接（/admin socket 命名空间） */
  private push: AdminPush = () => {};
  /** 服务器日志环形缓冲 */
  private logRing: Array<{ ts: number; level: string; text: string }> = [];
  private logSeq = 0;

  constructor(db: Db) {
    this.db = db;
  }

  setPush(fn: AdminPush) {
    this.push = fn;
  }

  /* ---------- 审计（管理操作） ---------- */

  audit(adminId: string, adminName: string, action: string, targetType = "", targetId = "", detail = "") {
    this.db.insertAudit(adminId, adminName, action, targetType, targetId, detail);
    this.push("admin:event", {
      kind: "audit",
      actor: adminName,
      actorId: adminId,
      text: `${adminName} ${action}${targetType ? ` ${targetType}` : ""}${detail ? ` · ${detail}` : ""}`,
      ts: Date.now(),
    });
  }

  /* ---------- 事件流（世界动态） ---------- */

  event(kind: string, actor: string, actorId: string, text: string, meta: Record<string, unknown> = {}) {
    this.db.insertEvent(kind, actor, actorId, text, JSON.stringify(meta));
    this.push("admin:event", { kind, actor, actorId, text, ts: Date.now(), ...meta });
  }

  /* ---------- 服务器日志捕获 ---------- */

  captureConsole() {
    const levels: Array<"log" | "warn" | "error"> = ["log", "warn", "error"];
    for (const level of levels) {
      const original = console[level].bind(console);
      console[level] = (...args: unknown[]) => {
        original(...args);
        const text = args
          .map((a) => (typeof a === "string" ? a : safeJson(a)))
          .join(" ")
          .slice(0, 500);
        this.logRing.push({ ts: Date.now(), level, text });
        if (this.logRing.length > 500) this.logRing.shift();
        this.push("admin:log", { id: ++this.logSeq, ts: Date.now(), level, text });
      };
    }
  }

  recentLogs(limit = 200) {
    return this.logRing.slice(-limit);
  }

  /* ---------- 在线趋势：用 join/leave 事件回放 ---------- */

  /**
   * 回放 event_log 里的 join/leave 事件，算每分钟在线人数曲线（历史可回溯）。
   * guest 用 playerId 计数（游客无账号），账号玩家用 userId 去重。
   */
  onlineTrend(minutes: number): OnlinePoint[] {
    const since = Date.now() - minutes * 60_000;
    const rows = this.db.listEventsSince(since, 5000);
    const online = new Map<string, number>(); // key → 离开时间戳（Infinity = 在线）
    const timeline: Array<{ t: number; delta: number }> = [];
    for (const r of rows) {
      if (r.kind === "join") {
        online.set(r.actorId, Infinity);
        timeline.push({ t: r.ts, delta: 1 });
      } else if (r.kind === "leave") {
        if (online.has(r.actorId)) {
          online.delete(r.actorId);
          timeline.push({ t: r.ts, delta: -1 });
        }
      }
    }
    timeline.sort((a, b) => a.t - b.t);
    // 分钟桶
    const bucketMs = 60_000;
    const start = Math.floor(since / bucketMs) * bucketMs;
    const buckets: number[] = new Array(Math.ceil((Date.now() - start) / bucketMs) + 1).fill(0);
    let running = 0;
    let ti = 0;
    for (let i = 0; i < buckets.length; i++) {
      const bucketEnd = start + i * bucketMs + bucketMs;
      while (ti < timeline.length && timeline[ti].t < bucketEnd) {
        running += timeline[ti].delta;
        ti++;
      }
      buckets[i] = Math.max(0, running);
    }
    return buckets.map((count, i) => ({ minute: start + i * bucketMs, count }));
  }
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
