// 个人面板接口（/api/me/*）：任何登录用户可访问，只看自己的数据
// 与 /api/admin/* 的区别：admin 需要 admin 角色，这里只需要有效 token
import type { Express } from "express";
import type { Db } from "./db.js";
import type { World } from "./engine/world.js";
import type { Presence } from "./engine/presence.js";
import { verifyToken } from "./auth.js";
import { verifyObjectProof } from "./attest.js";
import { chatComplete, encryptApiKey, isAllowedBaseUrl, providerById, publicProviders } from "./llm.js";
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

  // ---------- 我的 Agent 大脑（自带 LLM 配置，Key 只存密文、绝不回传） ----------

  /** 测试连接限流：每用户 6 次/分钟（真实调用外部厂商，防滥用） */
  const testHits = new Map<string, number[]>();
  const testRateOk = (uid: string) => {
    const now = Date.now();
    const hits = (testHits.get(uid) ?? []).filter((t) => now - t < 60_000);
    if (hits.length >= 6) return false;
    hits.push(now);
    testHits.set(uid, hits);
    return true;
  };

  /** 配置状态 + 厂商注册表（脱敏：只有 hasKey/尾号，没有明文） */
  app.get("/api/me/llm", (req: AuthedRequest, res) => {
    const user = me(req);
    if (!user) return res.status(401).json({ ok: false, reason: "请先登录" });
    res.json({ ok: true, providers: publicProviders(), config: db.llmConfigStatus(user.id) });
  });

  /** 保存配置（apiKey 留空 = 保留旧密钥） */
  app.put("/api/me/llm", (req: AuthedRequest, res) => {
    const user = me(req);
    if (!user) return res.status(401).json({ ok: false, reason: "请先登录" });
    const b = req.body as {
      provider?: string; model?: string; baseUrl?: string; apiKey?: string;
      persona?: string; temperature?: number; enabled?: boolean;
    };
    const provider = String(b.provider ?? "").trim();
    const def = providerById(provider);
    if (!def) return res.status(400).json({ ok: false, reason: "不支持的厂商" });

    const model = String(b.model ?? "").trim();
    if (!model || model.length > 60) return res.status(400).json({ ok: false, reason: "请填写模型名" });

    // custom 必须给基址；固定厂商用注册表基址（忽略前端传值，防篡改指向内网）
    let baseUrl = def.baseUrl;
    if (provider === "custom") {
      baseUrl = String(b.baseUrl ?? "").trim().replace(/\/+$/, "");
      if (!isAllowedBaseUrl(baseUrl)) return res.status(400).json({ ok: false, reason: "接口地址不合法（需 http/https，且不能指向内网）" });
    }

    // 密钥：传了就换新（8~200 字符），没传保留旧的
    let apiKeyEnc: string | null = null;
    const apiKey = String(b.apiKey ?? "").trim();
    if (apiKey) {
      if (apiKey.length < 8 || apiKey.length > 200) return res.status(400).json({ ok: false, reason: "API Key 长度不合法" });
      apiKeyEnc = encryptApiKey(apiKey);
    } else if (!db.llmConfigStatus(user.id)?.hasKey) {
      return res.status(400).json({ ok: false, reason: "请先填写 API Key" });
    }

    const persona = String(b.persona ?? "").trim().slice(0, 200);
    const temperature = Math.max(0, Math.min(1.5, Number(b.temperature ?? 0.7) || 0.7));
    const enabled = b.enabled !== false;

    db.saveLlmConfig(user.id, { provider, model, baseUrl, apiKeyEnc, persona, temperature, enabled });
    db.insertEvent("llm", user.name, user.id, `${enabled ? "启用" : "停用"} ${provider}/${model} 作为 Agent 大脑`, "{}");
    res.json({ ok: true, config: db.llmConfigStatus(user.id) });
  });

  /** 清除配置（连密钥一起删） */
  app.delete("/api/me/llm", (req: AuthedRequest, res) => {
    const user = me(req);
    if (!user) return res.status(401).json({ ok: false, reason: "请先登录" });
    db.clearLlmConfig(user.id);
    db.insertEvent("llm", user.name, user.id, "清除了 Agent 大模型配置", "{}");
    res.json({ ok: true });
  });

  /**
   * 测试连接：优先用提交的内容（没填 Key 时用已存密钥）真调一次小请求。
   * 返回延迟与模型回复，方便用户确认 Key/模型可用。
   */
  app.post("/api/me/llm/test", async (req: AuthedRequest, res) => {
    const user = me(req);
    if (!user) return res.status(401).json({ ok: false, reason: "请先登录" });
    if (!testRateOk(user.id)) return res.status(429).json({ ok: false, reason: "测试太频繁，稍后再试" });

    const b = req.body as { provider?: string; model?: string; baseUrl?: string; apiKey?: string };
    const provider = String(b.provider ?? "").trim();
    const def = providerById(provider);
    if (!def) return res.status(400).json({ ok: false, reason: "不支持的厂商" });
    const saved = db.getLlmConfig(user.id);
    const model = String(b.model ?? "").trim() || saved?.model || def.models[0];
    const apiKey = String(b.apiKey ?? "").trim() || (saved?.provider === provider ? saved.apiKey : "");
    let baseUrl = def.baseUrl;
    if (provider === "custom") {
      baseUrl = String(b.baseUrl ?? "").trim().replace(/\/+$/, "");
      if (!isAllowedBaseUrl(baseUrl)) return res.status(400).json({ ok: false, reason: "接口地址不合法" });
    }
    if (!apiKey) return res.status(400).json({ ok: false, reason: "还没有可用的 API Key" });

    const started = Date.now();
    try {
      const reply = await chatComplete(
        { baseUrl, chatPath: def.chatPath, apiKey, model, temperature: 0.3 },
        [
          { role: "system", content: "你是连通性测试助手。" },
          { role: "user", content: "请只回复两个字：收到" },
        ],
        { maxTokens: 16, timeoutMs: 15_000 }
      );
      res.json({ ok: true, latencyMs: Date.now() - started, model, reply: reply.slice(0, 60) });
    } catch (e) {
      const err = e as { status?: number; message?: string };
      res.json({
        ok: false,
        latencyMs: Date.now() - started,
        model,
        reason: `调用失败（${err.status ? `HTTP ${err.status}` : "网络"}）：${(err.message ?? "").slice(0, 180)}`,
      });
    }
  });
}
