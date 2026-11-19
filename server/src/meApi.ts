// 个人面板接口（/api/me/*）：任何登录用户可访问，只看自己的数据
// 与 /api/admin/* 的区别：admin 需要 admin 角色，这里只需要有效 token
import type { Express } from "express";
import type { Db } from "./db.js";
import type { World } from "./engine/world.js";
import type { Presence } from "./engine/presence.js";
import { verifyToken } from "./auth.js";
import { verifyObjectProof } from "./attest.js";
import type { AuthedRequest } from "./auth.js";

interface MeDeps {
  db: Db;
  world: World;
  presence: Presence;
}

export function registerMeApi(app: Express, deps: MeDeps) {
  const { db, world, presence } = deps;

  /** 身份校验：token 有效 + 账号存在且未封禁 */
  const me = (req: AuthedRequest): { id: string; name: string; role: string; createdAt: number } | null => {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    const payload = verifyToken(token);
    if (!payload) return null;
    const user = db.findUserById(payload.uid);
    if (!user || user.banned) return null;
    return { id: user.id, name: user.name, role: user.role, createdAt: user.createdAt };
  };

  /** 我的总览：四项面板的汇总 */
  app.get("/api/me/overview", (req: AuthedRequest, res) => {
    const user = me(req);
    if (!user) return res.status(401).json({ ok: false, reason: "请先登录" });
    const ownerKey = `u:${user.id}`;

    // ① agent 任务：office 房间的项目与任务（玩家是老板视角）+ agent 近期动作
    const office = db.loadOfficeState();
    const tasks = office.tasks.map((t) => ({
      ...t,
      projectName: office.projects.find((p) => p.id === t.projectId)?.name ?? "",
    }));

    // ② 我的聊天记录
    const chats = db.listChatFiltered({ q: "", kind: "", from: user.name, fromTs: 0, toTs: 0, limit: 100 });

    // ③ 我的造物与产权
    const myObjects = [...world.objects.values()]
      .filter((o) => o.creatorId === ownerKey)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((o) => {
        const proof = db.getObjectProof(o.id);
        return {
          id: o.id,
          kind: o.kind,
          variant: o.variant,
          x: o.x,
          z: o.z,
          createdAt: o.createdAt,
          sig: proof?.sig ?? "",
          valid: proof ? verifyObjectProof(o.id, o.creatorId, o.createdAt, proof.sig) : false,
        };
      });

    // ④ 活动时间线：我的放置/拆除/对话/进出事件
    const events = db
      .listEventsSince(0, 2000)
      .filter((e) => e.actorId === user.id || e.actorId === ownerKey)
      .slice(-120)
      .reverse();

    const online = presence.findByUserId(user.id);
    const doneTasks = tasks.filter((t) => t.status === "done").length;
    const runningTasks = tasks.filter((t) => t.status === "in_progress").length;

    res.json({
      ok: true,
      user: { id: user.id, name: user.name, role: user.role, createdAt: user.createdAt, lastLoginAt: db.findUserById(user.id)?.lastLoginAt ?? null },
      online: online ? { x: Math.round(online.x), z: Math.round(online.z), roomId: online.roomId } : null,
      agentTasks: {
        projects: office.projects.slice().reverse(),
        tasks,
        total: tasks.length,
        done: doneTasks,
        running: runningTasks,
        dialogues: office.dialogues.slice(-40).reverse(),
      },
      chats,
      objects: myObjects,
      objectStats: {
        total: myObjects.length,
        valid: myObjects.filter((o) => o.valid).length,
        broken: myObjects.filter((o) => !o.valid).length,
        byKind: Object.entries(
          myObjects.reduce<Record<string, number>>((acc, o) => {
            acc[o.kind] = (acc[o.kind] ?? 0) + 1;
            return acc;
          }, {})
        ).map(([label, value]) => ({ label, value })),
      },
      events,
      latestRoot: db.latestAttestRoot(),
    });
  });

  /** 我的聊天记录（可搜索、分页） */
  app.get("/api/me/chats", (req: AuthedRequest, res) => {
    const user = me(req);
    if (!user) return res.status(401).json({ ok: false, reason: "请先登录" });
    const q = req.query as { q?: string; limit?: string };
    const logs = db.listChatFiltered({
      q: String(q.q ?? ""),
      kind: "",
      from: user.name,
      fromTs: 0,
      toTs: 0,
      limit: Number(q.limit) || 100,
    });
    res.json({ ok: true, logs });
  });

  /** 我的造物列表（可按类型筛选） */
  app.get("/api/me/objects", (req: AuthedRequest, res) => {
    const user = me(req);
    if (!user) return res.status(401).json({ ok: false, reason: "请先登录" });
    const kind = String((req.query as { kind?: string }).kind ?? "");
    const list = [...world.objects.values()]
      .filter((o) => o.creatorId === `u:${user.id}`)
      .filter((o) => !kind || o.kind === kind)
      .sort((a, b) => b.createdAt - a.createdAt);
    res.json({ ok: true, objects: list });
  });
}
