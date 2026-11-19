// 后台管理 API：集中注册 /api/admin/* 路由（全部走 adminFromReq 实时查库守卫）
import type { Express, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import os from "node:os";
import {
  AdminChatRow,
  AdminOverview,
  AdminUserRow,
  AuditRow,
  GlobalSearchHit,
  PlayerRow,
  SystemInfo,
} from "@world3d/shared";
import type { Db } from "./db.js";
import type { World } from "./engine/world.js";
import type { Presence } from "./engine/presence.js";
import type { Audit } from "./audit.js";
import { buildMerkleRoot, verifyObjectProof } from "./attest.js";

interface AdminDeps {
  db: Db;
  world: World;
  presence: Presence;
  io: { emit: (ev: string, payload: unknown) => void };
  toSocket: (socketId: string, event: string, payload: unknown) => void;
  adminFromReq: (req: Request) => { id: string; name: string; role: string; createdAt: number } | null;
  audit: Audit;
}

export function registerAdminApi(app: Express, deps: AdminDeps) {
  const { db, world, presence, io, toSocket, adminFromReq, audit } = deps;

  const guard = (req: Request, res: Response): { id: string; name: string } | null => {
    const admin = adminFromReq(req);
    if (!admin) {
      res.status(403).json({ ok: false, reason: "需要管理员权限" });
      return null;
    }
    return admin;
  };

  /* ---------- 总览 ---------- */

  app.get("/api/admin/overview", (req, res) => {
    if (!guard(req, res)) return;
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const players = [...presence.players.values()];
    const overview: AdminOverview = {
      users: db.countUsers(),
      todayNewUsers: db.countTodayNewUsers(),
      online: players.length,
      guestsOnline: players.filter((p) => !p.userId).length,
      objects: world.objects.size,
      todayNewObjects: db.dailyCounts(1)[0]?.objects ?? 0,
      chatsToday: db.countChatsSince(dayStart.getTime()),
      projects: db.loadOfficeState().projects.length,
      chatRate: db.countChatsSince(Date.now() - 60_000),
      llmUsers: db.countLlmUsers(),
      trends: db.dailyCounts(14),
      onlineTrend: audit.onlineTrend(120),
      objectKinds: db.countObjectsByKind(),
      topCreators: db.countObjectsByCreator(),
      latestRoot: db.latestAttestRoot(),
    };
    res.json({ ok: true, overview });
  });

  app.get("/api/admin/trends", (req, res) => {
    if (!guard(req, res)) return;
    const days = Math.min(Math.max(Number((req.query as { days?: string }).days) || 14, 1), 90);
    res.json({ ok: true, trends: db.dailyCounts(days), online: audit.onlineTrend(180) });
  });

  /* ---------- 用户 ---------- */

  app.get("/api/admin/users", (req, res) => {
    if (!guard(req, res)) return;
    const q = req.query as { q?: string; role?: string; banned?: string; limit?: string; offset?: string };
    const filters = {
      q: String(q.q ?? ""),
      role: String(q.role ?? ""),
      banned: String(q.banned ?? ""),
    };
    const limit = Number(q.limit) || 20;
    const offset = Number(q.offset) || 0;
    const rows = db.listUsersFiltered({ ...filters, limit, offset });
    const users: AdminUserRow[] = rows.map((u) => ({
      id: u.id,
      name: u.name,
      role: u.role,
      banned: !!u.banned,
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt,
      online: !!presence.findByUserId(u.id),
    }));
    res.json({ ok: true, users, total: db.countUsersFiltered(filters) });
  });

  app.post("/api/admin/users/bulk", (req, res) => {
    const admin = guard(req, res);
    if (!admin) return;
    const { ids, action, value } = req.body ?? {};
    const list: string[] = Array.isArray(ids) ? ids.map(String).slice(0, 500) : [];
    if (!list.length) return res.json({ ok: false, reason: "没有选中用户" });
    let affected = 0;
    let failed = 0;
    for (const id of list) {
      if (id === admin.id) {
        failed++;
        continue;
      }
      const target = db.findUserById(id);
      if (!target) {
        failed++;
        continue;
      }
      if (action === "ban") {
        db.setUserBanned(id, true);
        kickOnline(id, "账号已被封禁");
      } else if (action === "unban") {
        db.setUserBanned(id, false);
      } else if (action === "role") {
        db.setUserRole(id, value === "admin" ? "admin" : "user");
      } else {
        failed++;
        continue;
      }
      affected++;
      audit.audit(admin.id, admin.name, `批量${action}`, "user", id, target.name);
    }
    res.json({ ok: true, affected, failed });
  });

  app.get("/api/admin/users/:id/detail", (req, res) => {
    if (!guard(req, res)) return;
    const user = db.findUserById(req.params.id);
    if (!user) return res.json({ ok: false, reason: "用户不存在" });
    const detail = db.userDetail(user.id);
    const online = presence.findByUserId(user.id);
    res.json({
      ok: true,
      user: { id: user.id, name: user.name, role: user.role, banned: !!user.banned, createdAt: user.createdAt, lastLoginAt: user.lastLoginAt },
      online: online ? { x: online.x, z: online.z, roomId: online.roomId } : null,
      llm: db.llmPublicInfo(user.id), // 自带 Agent 大脑（厂商/模型/开关，不含密钥）
      objects: detail.objects,
      chats: detail.chats,
    });
  });

  /* ---------- 在线玩家 ---------- */

  app.get("/api/admin/players", (req, res) => {
    if (!guard(req, res)) return;
    const players: PlayerRow[] = [...presence.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      userId: p.userId,
      isGuest: !p.userId,
      x: Math.round(p.x),
      z: Math.round(p.z),
      roomId: p.roomId,
      joinedAt: p.lastMove,
      lastMove: p.lastMove,
    }));
    res.json({ ok: true, players });
  });

  app.post("/api/admin/player/:id/kick", (req, res) => {
    const admin = guard(req, res);
    if (!admin) return;
    const p = presence.get(req.params.id);
    if (!p) return res.json({ ok: false, reason: "玩家不在线" });
    toSocket(p.socketId, "account:kicked", { reason: String(req.body?.reason ?? "已被管理员移出") });
    io.emit("chat", {
      id: randomUUID(),
      kind: "system",
      from: "系统",
      text: `🚪 ${p.name} 被管理员移出了世界`,
      ts: Date.now(),
    });
    db.insertChatLog("system", "系统", admin.id, `移出玩家 ${p.name}`);
    audit.audit(admin.id, admin.name, "踢出玩家", "player", p.id, p.name);
    audit.event("kick", admin.name, admin.id, `移出玩家 ${p.name}`);
    res.json({ ok: true });
  });

  app.post("/api/admin/player/:id/teleport", (req, res) => {
    const admin = guard(req, res);
    if (!admin) return;
    const p = presence.get(req.params.id);
    if (!p) return res.json({ ok: false, reason: "玩家不在线" });
    const x = Number(req.body?.x);
    const z = Number(req.body?.z);
    if (Number.isNaN(x) || Number.isNaN(z)) return res.json({ ok: false, reason: "坐标无效" });
    presence.updateMove(p.id, { x, y: world.heightAt(x, z), z, rotY: p.rotY, anim: "idle" });
    audit.audit(admin.id, admin.name, "传送玩家", "player", p.id, `${p.name} → (${Math.round(x)}, ${Math.round(z)})`);
    res.json({ ok: true });
  });

  app.post("/api/admin/player/:id/message", (req, res) => {
    const admin = guard(req, res);
    if (!admin) return;
    const p = presence.get(req.params.id);
    if (!p) return res.json({ ok: false, reason: "玩家不在线" });
    const text = String(req.body?.text ?? "").trim().slice(0, 200);
    if (!text) return res.json({ ok: false, reason: "内容为空" });
    toSocket(p.socketId, "admin:message", { text });
    audit.audit(admin.id, admin.name, "私信玩家", "player", p.id, text);
    res.json({ ok: true });
  });

  /* ---------- 广播公告 ---------- */

  app.post("/api/admin/broadcast", (req, res) => {
    const admin = guard(req, res);
    if (!admin) return;
    const text = String(req.body?.text ?? "").trim().slice(0, 300);
    if (!text) return res.json({ ok: false, reason: "公告内容为空" });
    io.emit("chat", { id: randomUUID(), kind: "system", from: "📢 公告", text, ts: Date.now() });
    db.insertChatLog("system", "📢 公告", admin.id, text);
    audit.audit(admin.id, admin.name, "发布公告", "broadcast", "", text);
    audit.event("broadcast", admin.name, admin.id, `发布公告：${text}`);
    res.json({ ok: true });
  });

  /* ---------- 造物 ---------- */

  app.get("/api/admin/objects", (req, res) => {
    if (!guard(req, res)) return;
    const q = req.query as { q?: string; kind?: string; creator?: string; limit?: string; offset?: string };
    const search = String(q.q ?? "");
    const kind = String(q.kind ?? "");
    const creator = String(q.creator ?? "");
    const limit = Math.min(Number(q.limit) || 30, 200);
    const offset = Math.max(Number(q.offset) || 0, 0);
    let list = [...world.objects.values()];
    if (search)
      list = list.filter(
        (o) => o.kind.includes(search) || o.variant.includes(search) || o.creatorName.includes(search) || o.id.includes(search)
      );
    if (kind) list = list.filter((o) => o.kind === kind);
    if (creator) list = list.filter((o) => o.creatorName.includes(creator));
    list.sort((a, b) => b.createdAt - a.createdAt);
    res.json({
      ok: true,
      objects: list.slice(offset, offset + limit),
      total: list.length,
      kinds: db.countObjectsByKind(),
    });
  });

  app.post("/api/admin/objects/bulk", (req, res) => {
    const admin = guard(req, res);
    if (!admin) return;
    const { ids, action } = req.body ?? {};
    const list: string[] = Array.isArray(ids) ? ids.map(String).slice(0, 500) : [];
    if (!list.length) return res.json({ ok: false, reason: "没有选中造物" });
    if (action !== "delete") return res.json({ ok: false, reason: "未知操作" });
    let affected = 0;
    for (const id of list) {
      const o = world.objects.get(id);
      if (!o) continue;
      world.removeObject(id);
      db.deleteObject(id);
      io.emit("world:remove", { id, by: admin.id });
      affected++;
      audit.audit(admin.id, admin.name, "删除造物", "object", id, `${o.kind}（${o.creatorName}）`);
    }
    res.json({ ok: true, affected });
  });

  /* ---------- 聊天记录 ---------- */

  app.get("/api/admin/chat", (req, res) => {
    if (!guard(req, res)) return;
    const q = req.query as { q?: string; kind?: string; from?: string; fromTs?: string; toTs?: string; limit?: string };
    const logs: AdminChatRow[] = db.listChatFiltered({
      q: String(q.q ?? ""),
      kind: String(q.kind ?? ""),
      from: String(q.from ?? ""),
      fromTs: Number(q.fromTs) || 0,
      toTs: Number(q.toTs) || 0,
      limit: Number(q.limit) || 50,
    });
    res.json({ ok: true, logs });
  });

  app.get("/api/admin/chat/export.csv", (req, res) => {
    if (!guard(req, res)) return;
    const q = req.query as { q?: string; kind?: string; from?: string };
    const logs = db.listChatFiltered({
      q: String(q.q ?? ""),
      kind: String(q.kind ?? ""),
      from: String(q.from ?? ""),
      fromTs: 0,
      toTs: 0,
      limit: 200,
    });
    const csv = ["时间,类型,发送者,内容", ...logs.map((l) => [new Date(l.ts).toLocaleString("zh-CN"), l.kind, l.from, csvCell(l.text)].join(","))].join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="chatlog-${Date.now()}.csv"`);
    res.send("﻿" + csv); // BOM 让 Excel 正确识别 UTF-8
  });

  /* ---------- 审计 ---------- */

  app.get("/api/admin/audit", (req, res) => {
    if (!guard(req, res)) return;
    const action = (req.query as { action?: string }).action;
    const rows: AuditRow[] = db.listAudit(action ? String(action) : null, Number((req.query as { limit?: string }).limit) || 50);
    res.json({ ok: true, audits: rows, total: db.countAudit() });
  });

  /* ---------- 系统运维 ---------- */

  app.get("/api/admin/system", (req, res) => {
    if (!guard(req, res)) return;
    const mem = process.memoryUsage();
    const info: SystemInfo = {
      uptime: Math.floor(process.uptime()),
      startedAt: Date.now() - Math.floor(process.uptime()) * 1000,
      memory: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        system: os.totalmem(),
      },
      cpu: os.cpus().length,
      node: process.version,
      platform: `${os.type()} ${os.release()}`,
      dbSize: db.dbSizeBytes(),
      counts: db.tableCounts(),
    };
    res.json({ ok: true, info, logs: audit.recentLogs(120) });
  });

  app.get("/api/admin/events", (req, res) => {
    if (!guard(req, res)) return;
    res.json({ ok: true, events: db.listEvents(Number((req.query as { limit?: string }).limit) || 60) });
  });

  /* ---------- 全局搜索 ---------- */

  app.get("/api/admin/search", (req, res) => {
    if (!guard(req, res)) return;
    const q = String((req.query as { q?: string }).q ?? "").trim();
    if (!q) return res.json({ ok: true, hits: [] });
    const hits: GlobalSearchHit[] = [];
    const users = db.listUsersFiltered({ q, role: "", banned: "", limit: 5, offset: 0 });
    for (const u of users)
      hits.push({ type: "user", id: u.id, title: u.name, sub: u.role === "admin" ? "管理员" : u.banned ? "已封禁" : "玩家", ts: u.createdAt });
    for (const o of db.searchObjects(q, 5))
      hits.push({ type: "object", id: o.id, title: `${o.kind} ${o.variant ?? ""}`.trim(), sub: `by ${o.creatorName}`, ts: o.createdAt });
    for (const c of db.searchChats(q, 5))
      hits.push({ type: "chat", id: String(c.id), title: c.text.slice(0, 60), sub: `by ${c.from}`, ts: c.ts });
    hits.sort((a, b) => b.ts - a.ts);
    res.json({ ok: true, hits: hits.slice(0, 12) });
  });

  /* ---------- 存证对账 ---------- */

  app.post("/api/admin/attest/reconcile", (req, res) => {
    const admin = guard(req, res);
    if (!admin) return;
    const entries = [...world.objects.values()].map((o) => ({ id: o.id, creatorId: o.creatorId }));
    const current = buildMerkleRoot(entries);
    const latest = db.latestAttestRoot();
    const consistent = !!latest && latest.root === current.root;
    // 逐件验章（找出被篡改的具体造物）
    const broken: string[] = [];
    for (const o of world.objects.values()) {
      const proof = db.getObjectProof(o.id);
      if (!proof || !verifyObjectProof(o.id, o.creatorId, o.createdAt, proof.sig)) broken.push(o.id);
    }
    audit.audit(admin.id, admin.name, "存证对账", "attest", "", consistent ? "一致" : `发现 ${broken.length} 处异常`);
    res.json({ ok: true, consistent, current: current.root, latest: latest?.root ?? null, broken });
  });

  /* ---------- 工具 ---------- */

  function kickOnline(userId: string, reason: string) {
    const online = presence.findByUserId(userId);
    if (!online) return;
    toSocket(online.socketId, "account:kicked", { reason });
    io.emit("chat", {
      id: randomUUID(),
      kind: "system",
      from: "系统",
      text: `🚪 ${online.name} 被管理员移出了世界`,
      ts: Date.now(),
    });
  }
}

function csvCell(s: string): string {
  return `"${String(s).replace(/"/g, '""')}"`;
}
