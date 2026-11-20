import express from "express";
import { createServer } from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Server, Socket } from "socket.io";
import { randomUUID } from "node:crypto";
import {
  AdminStats,
  AdminUserRow,
  AuthUser,
  HelloPayload,
  MoveInput,
  PlayerInfo,
  RoomHello,
  WorldObject,
  PROP_KINDS,
} from "@world3d/shared";
import { World } from "./engine/world.js";
import { Db } from "./db.js";
import { Presence, Player } from "./engine/presence.js";
import { Builder } from "./engine/builder.js";
import { OfficeRoom, OFFICE_ROOM_ID } from "./engine/office/officeRoom.js";
import { hashPassword, initAuth, issueToken, loginRateOk, verifyPassword, verifyToken, authFromReq, AuthedRequest } from "./auth.js";
import { attestPublicKeyPem, buildMerkleRoot, initAttest, signObject, verifyObjectProof } from "./attest.js";
import { Audit } from "./audit.js";
import { registerAdminApi } from "./adminApi.js";
import { registerMeApi } from "./meApi.js";
import { initLlmCrypto, providerById } from "./llm.js";
import { LlmBrain } from "./engine/office/llmBrain.js";

// 平台（Render/Railway 等）会注入 PORT；本地默认 8788
const PORT = Number(process.env.PORT ?? 8788);

const app = express();
app.use(express.json());
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

// 生产模式：托管前端构建产物（client/dist），本地开发仍走 vite 5174
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// dev(tsx, src/) 与生产(dist/)都是 world3d 下两级 → ../../client/dist
const clientDist = path.resolve(__dirname, "../../client/dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^\/(?!api|socket\.io).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
  console.log(`[world3d] serving client from ${clientDist}`);
}

const DATA_DIR = process.env.WORLD3D_DATA ?? path.resolve("data");
const db = new Db(DATA_DIR);
initAuth(DATA_DIR);
initAttest(DATA_DIR);
initLlmCrypto(DATA_DIR);
const world = new World();
const presence = new Presence();
const builder = new Builder(world, db);
const officeRoom = new OfficeRoom(db);
const audit = new Audit(db);
audit.captureConsole(); // 捕获服务器日志 → 后台实时终端

// ---------- 产权存证：签名走 db.insertObject 统一漏斗（手搓/AI/系统建筑全覆盖） ----------

let placedSinceRoot = 0;
function publishRoot(reason: string) {
  const entries = [...world.objects.values()].map((o) => ({ id: o.id, creatorId: o.creatorId }));
  const { root, count } = buildMerkleRoot(entries);
  db.insertAttestRoot(root, count);
  placedSinceRoot = 0;
  console.log(`[attest] root published (${reason}) count=${count} root=${root.slice(0, 16)}…`);
}
db.onInsertObject = (o) => {
  db.insertObjectProof(o.id, signObject(o.id, o.creatorId, o.createdAt));
  if (++placedSinceRoot >= 50) publishRoot("batch");
};
db.onDeleteObject = (id) => db.deleteObjectProof(id);

// 开服对账（延迟 3s：等办公楼 boot 插入完毕）：离线期间的变更若与最新公示根不一致 → 发布新根
setTimeout(() => {
  const entries = [...world.objects.values()].map((o) => ({ id: o.id, creatorId: o.creatorId }));
  const latest = db.latestAttestRoot();
  const current = buildMerkleRoot(entries);
  if (!latest || latest.root !== current.root) publishRoot(latest ? "boot-diff" : "boot-init");
}, 3000).unref?.();
setInterval(() => publishRoot("interval"), 10 * 60_000).unref();

/** admin 守卫：token 角色可能过期（被降权/封禁），实时查库 */
function adminFromReq(req: AuthedRequest): AuthUser | null {
  const auth = authFromReq(req);
  if (!auth || auth.role !== "admin") return null;
  const user = db.findUserById(auth.uid);
  if (!user || user.banned || user.role !== "admin") return null;
  return { id: user.id, name: user.name, role: user.role, createdAt: user.createdAt };
}

// 重放持久化数据
for (const mod of db.loadMods()) world.mods.set(mod.id, { ...mod });
for (const o of db.loadObjects()) world.objects.set(o.id, { ...o, params: (o.params ?? {}) as Record<string, unknown> });

// 办公楼造物（boot 时确保存在）；出生点迁移到南岸后，老办公楼自动搬进新出生区
const OFFICE_BUILDING = { kind: "office", variant: "小世界科技", x: 118, z: 114, rotY: 0.62, doorDist: 4.6 };
const SPAWN = world.findSpawn();
// 出生点局部坐标系：+z_local = 面朝大海（岛心→出生点向外），+x_local = 画面右侧
const SPAWN_C = world.size / 2;
const SPAWN_UX = (SPAWN.x - SPAWN_C) / (Math.hypot(SPAWN.x - SPAWN_C, SPAWN.z - SPAWN_C) || 1);
const SPAWN_UZ = (SPAWN.z - SPAWN_C) / (Math.hypot(SPAWN.x - SPAWN_C, SPAWN.z - SPAWN_C) || 1);
const spawnLocal = (lx: number, lz: number) => ({ x: SPAWN.x + lx * SPAWN_UZ + lz * SPAWN_UX, z: SPAWN.z - lx * SPAWN_UX + lz * SPAWN_UZ });
const OFFICE_POS = spawnLocal(-16, -14); // 楼在出生点身后偏右更远处（朝岛心），门朝出生点，不抢出生画面的镜
console.log(`[world3d] 出生点 (${SPAWN.x.toFixed(1)}, ${SPAWN.z.toFixed(1)}) 办公楼 (${OFFICE_POS.x.toFixed(1)}, ${OFFICE_POS.z.toFixed(1)})`);
const OFFICE_ROTY = Math.atan2(SPAWN.x - OFFICE_POS.x, SPAWN.z - OFFICE_POS.z);
if (![...world.objects.values()].some((o) => o.kind === "office")) {
  const row = world.addObject(
    {
      kind: OFFICE_BUILDING.kind,
      variant: OFFICE_BUILDING.variant,
      x: OFFICE_POS.x,
      z: OFFICE_POS.z,
      rotY: OFFICE_ROTY,
      scale: 1,
      creatorId: "system",
      creatorName: "小世界",
      createdAt: Date.now(),
      params: { doorDist: OFFICE_BUILDING.doorDist },
    },
    { doorDist: OFFICE_BUILDING.doorDist }
  );
  db.insertObject(row);
} else {
  const office = [...world.objects.values()].find((o) => o.kind === "office")!;
  // 与「理想落位」对齐（位置差 >6m 或朝向差 >0.3rad 就搬）：出生点一变楼就跟着归位，门口正对出生点
  if (Math.hypot(office.x - OFFICE_POS.x, office.z - OFFICE_POS.z) > 6 || Math.abs(office.rotY - OFFICE_ROTY) > 0.3) {
    office.x = OFFICE_POS.x;
    office.z = OFFICE_POS.z;
    office.rotY = OFFICE_ROTY;
    db.updateObjectPos(office.id, office.x, office.z, office.rotY);
  }
}

const toSocket = (socketId: string, event: string, payload: unknown) => {
  io.to(socketId).emit(event, payload);
};
presence.attach(io, toSocket);
builder.attach(io);

// 出生点迎宾景观（boot 时对账）：树花按当前出生点布局对齐 —— 多余/错位删除，缺失补种（不动用户造物）
{
  const S = SPAWN;
  // 期望布局（与下方种树表一致）
  const welcomeOffsets: Array<[number, number, string, "tree" | "flower"]> = [
    [2.6, 4.2, "樱花", "tree"],
    [-2.8, 4.8, "樱花", "tree"],
    [-11, -3, "樱花", "tree"],
    [11.5, -3.5, "樱花", "tree"],
    [-12.5, -7, "白桦", "tree"],
    [13, -7.5, "橡", "tree"],
    [4.5, -1.5, "粉", "flower"],
    [-5, -2, "白", "flower"],
    [3, -6.5, "黄", "flower"],
    [-3.5, -7, "粉", "flower"],
  ];
  const expected = welcomeOffsets.map(([lx, lz, variant, kind]) => ({ ...spawnLocal(lx, lz), variant, kind }));
  // 清场：system 树花里凡是没对上期望布局的（错位/旧版/漂移残留）一律移除
  for (const o of [...world.objects.values()]) {
    if (o.creatorId !== "system" || (o.kind !== "tree" && o.kind !== "flower")) continue;
    const hit = expected.find(
      (e) => e.kind === o.kind && e.variant === o.variant && Math.hypot(e.x - o.x, e.z - o.z) < 1.2
    );
    if (!hit) {
      world.objects.delete(o.id);
      db.deleteObject(o.id);
    }
  }
  // 补种：期望布局里缺失的坑位逐个补上
  for (const p of expected) {
    const exists = [...world.objects.values()].some(
      (o) => o.creatorId === "system" && o.kind === p.kind && Math.hypot(o.x - p.x, o.z - p.z) < 1.2
    );
    if (exists) continue;
    const h = world.heightAt(Math.floor(p.x), Math.floor(p.z));
    // 岸线樱花允许站在水线/湿沙里（海岸樱花），花草只种在干地上
    const minH = p.kind === "tree" ? 7.2 : 10.6;
    if (h < minH) continue;
    const row = world.addObject(
      { kind: p.kind, variant: p.variant, x: p.x, z: p.z, rotY: Math.random() * Math.PI * 2, scale: p.kind === "tree" ? 1.15 : 1, creatorId: "system", creatorName: "小世界", createdAt: Date.now(), params: {} },
      {}
    );
    db.insertObject(row);
  }
}

/** 编排器事件名 → 客户端 room:* 事件名映射 */
const ROOM_EVENT_MAP: Record<string, string> = {
  "agent:order": "room:order",
  "agent:updated": "room:agent",
  "agent:removed": "room:agentRemoved",
  "agentMove": "room:agentMove",
  "dialogue:line": "room:dialogue",
  "project:updated": "room:project",
  "task:updated": "room:task",
  "task:progress": "room:progress",
  "notify": "room:notify",
  "meeting:started": "room:meeting:started",
  "meeting:ended": "room:meeting:ended",
  // agent 对老板的应答走聊天流（客户端 chat 频道）
  chat: "chat",
};

// 启动播种：把玩家雇佣的个人 agent 送进办公室（有空余加座才入座）
officeRoom.syncPersonalAgents();

/** 房间内广播：发给所有在该房间的玩家 */
const emitToRoom = (ev: string, payload: unknown) => {
  const wired = ROOM_EVENT_MAP[ev] ?? `room:${ev}`;
  for (const p of presence.playersInRoom(OFFICE_ROOM_ID)) toSocket(p.socketId, wired, payload);
};
officeRoom.attach(emitToRoom);
// 玩家自带 LLM：登录账号且在 /me 配置并启用了大模型 → 办公室 agent 用 TA 的模型说话/干活
officeRoom.orch.brainFor = (playerId) => {
  const p = playerId ? presence.get(playerId) : null;
  if (!p?.userId) return null;
  return llmHookForUser(p.userId, p.name);
};
// 个人 agent（我的员工）被搭话：用雇主配置的大模型应答
officeRoom.orch.brainForUser = (userId) => {
  const online = presence.findByUserId(userId);
  return llmHookForUser(userId, online?.name ?? db.findUserById(userId)?.name ?? "老板");
};
function llmHookForUser(userId: string, playerName: string) {
  const cfg = db.getLlmConfig(userId);
  if (!cfg || !cfg.enabled) return null;
  const def = providerById(cfg.provider);
  // 固定厂商基址/路径实时取注册表（厂商迁域名时老配置自动跟上，无需重保存）；custom 用用户落库的基址
  const baseUrl = cfg.provider === "custom" ? cfg.baseUrl : def?.baseUrl ?? cfg.baseUrl;
  return {
    brain: new LlmBrain({
      baseUrl,
      chatPath: def?.chatPath ?? "/chat/completions",
      apiKey: cfg.apiKey,
      model: cfg.model,
      temperature: cfg.temperature,
      persona: cfg.persona,
    }),
    playerName,
    modelLabel: cfg.model,
  };
}
// 编排器环境行为需要房间内玩家位置（agent 主动走近老板搭话）
officeRoom.orch.playerProvider = () =>
  presence.playersInRoom(OFFICE_ROOM_ID).map((p) => ({ id: p.id, x: p.x, z: p.z }));

/** 跨空间事件过滤：同一空间（同房间或同为户外）才收 player:join/leave */
function emitSameSpace(target: Player | null, event: string, payload: unknown) {
  if (!target) return;
  for (const p of presence.players.values()) {
    if (p.id === target.id || p.roomId !== target.roomId) continue;
    toSocket(p.socketId, event, payload);
  }
}

/** 离开世界/断线/换身份前：解除附身（被操控的员工自己走回工位） */
function releasePossessionOnExit(playerId: string) {
  if (officeRoom.possessorOf(playerId)) officeRoom.releaseByPlayer(playerId, true);
}

/**
 * 离开（断线/主动退出/换身份统一路径）：小人**留在原地驻留**为离线状态（半透明💤），
 * 同身份（登录 userId / 游客 guestId）再上线从原地复活；登录玩家位置落库，重启后也能原地复活。
 * 在房间内则先请出房间（恢复户外位置驻留，房间列表/编排器自然解除引用）。
 */
function dwellOffline(p: Player, silent = false) {
  releasePossessionOnExit(p.id);
  const wasInRoom = !!p.roomId;
  presence.markOffline(p.id);
  if (wasInRoom) emitToRoom("playerLeave", { id: p.id }); // 房内其他人删掉该 remote（房内是局部坐标）
  if (p.userId) db.savePlayerPos(p.userId, p.x, p.y, p.z, p.rotY);
  if (!silent) {
    const leaveText = `💤 ${p.name} 下线了，小人留在原地`;
    io.emit("chat", { id: randomUUID(), kind: "system", from: "系统", text: leaveText, ts: Date.now() });
    db.insertChatLog("system", "系统", p.userId ?? p.id, leaveText);
    audit.event("leave", p.name, p.userId ?? p.id, `${p.name} 下线（小人原地驻留）`);
  }
}

// ---------- REST ----------
app.get("/api/state", (_req, res) => {
  res.json({
    players: [...presence.players.values()].map((p) => presence.publicInfo(p)),
    objects: db.loadObjects(),
    mods: db.loadMods(),
  });
});

// ---------- 账号 ----------

const ipOf = (req: { socket: { remoteAddress?: string | null } }) => req.socket.remoteAddress ?? "?";

app.post("/api/auth/register", (req, res) => {
  if (!loginRateOk(ipOf(req))) return res.status(429).json({ ok: false, reason: "试得太频繁了，等一分钟再来" });
  const name = String(req.body?.name ?? "").trim();
  const pass = String(req.body?.password ?? "");
  if (!/^[\u4e00-\u9fa5A-Za-z0-9_-]{2,12}$/.test(name)) return res.json({ ok: false, reason: "昵称需 2-12 位中英文/数字" });
  if (pass.length < 4 || pass.length > 64) return res.json({ ok: false, reason: "密码至少 4 位" });
  if (db.findUserByName(name)) return res.json({ ok: false, reason: "这个名字已被注册" });
  const role = db.countUsers() === 0 ? "admin" : "user"; // 首位注册者即管理员
  const row = db.createUser(name, hashPassword(pass), role);
  const user: AuthUser = { id: row.id, name: row.name, role, createdAt: row.createdAt };
  console.log(`[auth] register ${name} (${role})`);
  res.json({ ok: true, token: issueToken(user), user });
});

app.post("/api/auth/login", (req, res) => {
  if (!loginRateOk(ipOf(req))) return res.status(429).json({ ok: false, reason: "试得太频繁了，等一分钟再来" });
  const name = String(req.body?.name ?? "").trim();
  const pass = String(req.body?.password ?? "");
  const row = db.findUserByName(name);
  if (!row || !verifyPassword(pass, row.passHash)) return res.json({ ok: false, reason: "用户名或密码不对" });
  if (row.banned) return res.json({ ok: false, reason: "账号已被封禁，联系管理员解封" });
  db.touchLogin(row.id);
  const user: AuthUser = { id: row.id, name: row.name, role: row.role, createdAt: row.createdAt };
  console.log(`[auth] login ${name}`);
  res.json({ ok: true, token: issueToken(user), user });
});

app.get("/api/auth/me", (req: AuthedRequest, res) => {
  const auth = authFromReq(req);
  if (!auth) return res.status(401).json({ ok: false, reason: "登录已过期" });
  const row = db.findUserById(auth.uid);
  if (!row) return res.status(401).json({ ok: false, reason: "账号不存在" });
  if (row.banned) return res.status(403).json({ ok: false, reason: "账号已被封禁" });
  res.json({ ok: true, user: { id: row.id, name: row.name, role: row.role, createdAt: row.createdAt } });
});

// ---------- 产权存证（公开：任何人可验章） ----------

app.get("/api/attest/root", (_req, res) => {
  res.json({ root: db.latestAttestRoot(), publicKey: attestPublicKeyPem() });
});

app.get("/api/attest/object/:id", (req, res) => {
  // 以账本（DB）为准验章，不用内存副本——这样外部直接改库也能立刻暴露
  const o = db.getObjectRow(req.params.id);
  const proof = db.getObjectProof(req.params.id);
  if (!o || !proof) return res.json({ ok: false, reason: "查无此造物或未存证" });
  res.json({
    ok: true,
    proof: {
      objectId: o.id,
      creatorId: o.creatorId,
      creatorName: o.creatorName,
      createdAt: o.createdAt,
      sig: proof.sig,
      valid: verifyObjectProof(o.id, o.creatorId, o.createdAt, proof.sig),
    },
  });
});

// ---------- 后台管理（admin） ----------
// 全部路由在 adminApi.ts 里注册（这里只做接线）

registerAdminApi(app, { db, world, presence, io, toSocket, adminFromReq, audit });

// 个人面板（任何登录用户）：只读自己的数据
registerMeApi(app, { db, world, presence, officeRoom });

// 兼容旧路径（保留给旧前端）
app.get("/api/admin/stats", (req: AuthedRequest, res) => {
  if (!adminFromReq(req)) return res.status(403).json({ ok: false, reason: "需要管理员权限" });
  const stats: AdminStats = {
    users: db.countUsers(),
    todayNewUsers: db.countTodayNewUsers(),
    online: presence.players.size,
    objects: world.objects.size,
    projects: db.loadOfficeState().projects.length,
    latestRoot: db.latestAttestRoot(),
  };
  res.json({ ok: true, stats });
});
app.get("/api/admin/projects", (req: AuthedRequest, res) => {
  if (!adminFromReq(req)) return res.status(403).json({ ok: false, reason: "需要管理员权限" });
  const s = db.loadOfficeState();
  res.json({ ok: true, projects: s.projects, tasks: s.tasks });
});
app.get("/api/admin/attest", (req: AuthedRequest, res) => {
  if (!adminFromReq(req)) return res.status(403).json({ ok: false, reason: "需要管理员权限" });
  res.json({ ok: true, roots: db.listAttestRoots(), publicKey: attestPublicKeyPem() });
});
app.get("/api/admin/chatlog", (req: AuthedRequest, res) => {
  if (!adminFromReq(req)) return res.status(403).json({ ok: false, reason: "需要管理员权限" });
  const before = Number((req.query as { before?: string }).before) || null;
  const limit = Number((req.query as { limit?: string }).limit) || 50;
  res.json({ ok: true, logs: db.listChatLogs(before, limit) });
});
app.post("/api/admin/user/:id/role", (req: AuthedRequest, res) => {
  const admin = adminFromReq(req);
  if (!admin) return res.status(403).json({ ok: false, reason: "需要管理员权限" });
  const role = req.body?.role === "admin" ? "admin" : "user";
  if (req.params.id === admin.id && role !== "admin") return res.json({ ok: false, reason: "不能取消自己的管理员" });
  const target = db.findUserById(req.params.id);
  if (!target) return res.json({ ok: false, reason: "用户不存在" });
  db.setUserRole(target.id, role);
  audit.audit(admin.id, admin.name, "设置角色", "user", target.id, `${target.name} → ${role}`);
  res.json({ ok: true });
});
app.post("/api/admin/user/:id/ban", (req: AuthedRequest, res) => {
  const admin = adminFromReq(req);
  if (!admin) return res.status(403).json({ ok: false, reason: "需要管理员权限" });
  const banned = !!req.body?.banned;
  if (req.params.id === admin.id) return res.json({ ok: false, reason: "不能封禁自己" });
  const target = db.findUserById(req.params.id);
  if (!target) return res.json({ ok: false, reason: "用户不存在" });
  db.setUserBanned(target.id, banned);
  audit.audit(admin.id, admin.name, banned ? "封禁" : "解封", "user", target.id, target.name);
  if (banned) {
    const online = presence.findByUserId(target.id);
    if (online) {
      toSocket(online.socketId, "account:kicked", { reason: "账号已被封禁" });
      io.sockets.sockets.get(online.socketId)?.disconnect(true);
    }
  }
  res.json({ ok: true });
});
app.delete("/api/admin/object/:id", (req: AuthedRequest, res) => {
  const admin = adminFromReq(req);
  if (!admin) return res.status(403).json({ ok: false, reason: "需要管理员权限" });
  const o = world.objects.get(req.params.id);
  if (!o) return res.json({ ok: false, reason: "造物不存在" });
  world.removeObject(o.id);
  db.deleteObject(o.id);
  io.emit("world:remove", { id: o.id, by: admin.id });
  audit.audit(admin.id, admin.name, "删除造物", "object", o.id, `${o.kind}（${o.creatorName}）`);
  res.json({ ok: true });
});

// ---------- Socket ----------
io.on("connection", (socket: Socket) => {
  let playerId: string | null = null;
  let lastPosSave = 0;

  socket.on("join", ({ name, token, guestId }: { name: string; token?: string; guestId?: string }, ack?: (h: HelloPayload) => void) => {
    // 幂等：同一连接重复 join（切账号 / 账号→游客）把旧身份转为离线驻留（小人留原地），
    // 不再广播 player:leave —— 旧化身原地变灰，别人看到的是「下线驻留」
    if (playerId) {
      const old = presence.get(playerId);
      playerId = null;
      if (old) dwellOffline(old);
    }
    // 账号玩家：token 验证 → 昵称取账号名，造物归属跨会话稳定
    let userId: string | null = null;
    let displayName = String(name ?? "").slice(0, 12) || `旅人_${socket.id.slice(0, 4)}`;
    const auth = verifyToken(token ?? null);
    if (auth) {
      const user = db.findUserById(auth.uid);
      if (user && !user.banned) {
        userId = user.id;
        displayName = user.name.slice(0, 12);
      }
    }
    // 登录玩家：服务重启后内存条目丢失 → 用落库的最后位置复活（重启前的原地）
    // 出生点用 boot 时算好的 SPAWN：join 时重跑 findSpawn 会被已生成的办公楼/迎宾树挡位，出生点漂移
    let spawn = SPAWN;
    if (userId) {
      const last = db.getPlayerPos(userId);
      if (last) spawn = { x: last.x, y: last.y, z: last.z };
    }
    const { player, resumed } = presence.join(displayName, socket.id, spawn, userId, guestId ? String(guestId).slice(0, 40) : null);
    playerId = player.id;

    const hello: HelloPayload = {
      meta: world.publicMeta(),
      selfId: player.id,
      self: presence.publicInfo(player),
      // 只发同空间（户外）的玩家（含离线驻留的，带 online:false），房间内玩家的坐标是房间局部坐标，跨空间会出鬼影
      players: [...presence.players.values()]
        .filter((p) => p.id !== player.id && p.roomId === player.roomId)
        .map((p) => presence.publicInfo(p)),
      objects: [...world.objects.values()],
      terrainMods: [...world.mods.values()],
    };
    ack?.(hello);

    const joinText = resumed ? `👋 ${displayName} 回来了（小人原地复活）` : `👋 ${displayName} 进入了世界`;
    io.emit("chat", { id: randomUUID(), kind: "system", from: "系统", text: joinText, ts: Date.now() });
    db.insertChatLog("system", "系统", userId ?? player.id, joinText);
    audit.event("join", displayName, userId ?? player.id, `${displayName} ${resumed ? "复活（原地）" : "进入了世界"}`, { guest: !userId });
    emitSameSpace(player, "player:join", presence.publicInfo(player));
  });

  /** 主动离开世界（切换账号 / 换游客时客户端调用）：小人转为离线驻留（原地留灰影），不等 socket 断开 */
  socket.on("leave", () => {
    if (!playerId) return;
    const p = presence.get(playerId);
    playerId = null;
    if (!p) return;
    dwellOffline(p);
  });

  socket.on("move", (mv: MoveInput) => {
    if (!playerId) return;
    if (typeof mv?.x !== "number" || typeof mv?.z !== "number") return;
    presence.updateMove(playerId, mv);
    // 登录玩家位置节流落库（30s），服务重启后上线仍从原地复活
    const p = presence.get(playerId);
    if (p?.userId && Date.now() - lastPosSave > 30_000) {
      lastPosSave = Date.now();
      db.savePlayerPos(p.userId, p.x, p.y, p.z, p.rotY);
    }
  });

  /** 手搓放置道具 */
  socket.on(
    "place",
    (
      payload: { kind: string; variant: string; x: number; z: number; rotY?: number },
      ack?: (res: { ok: boolean; reason?: string; object?: WorldObject }) => void
    ) => {
      const p = playerId ? presence.get(playerId) : null;
      if (!p) return ack?.({ ok: false, reason: "未加入世界" });
      const kind = String(payload?.kind ?? "");
      const variant = String(payload?.variant ?? "");
      const x = Number(payload?.x);
      const z = Number(payload?.z);
      if (kind === "office") return ack?.({ ok: false, reason: "办公楼是系统建筑，不能手搓哦" });
      if (!PROP_KINDS[kind] || Number.isNaN(x) || Number.isNaN(z)) return ack?.({ ok: false, reason: "参数无效" });
      const v = world.validatePlacement(kind, x, z);
      if (!v.ok) return ack?.({ ok: false, reason: v.reason });
      // 归属：登录玩家用账号 id（跨会话稳定），游客用当次会话 id
      const creatorId = p.userId ? `u:${p.userId}` : p.id;
      const row = world.addObject(
        {
          kind,
          variant,
          x,
          z,
          rotY: Number(payload?.rotY ?? 0),
          scale: 1,
          creatorId,
          creatorName: p.name,
          createdAt: Date.now(),
          params: {},
        },
        {}
      );
      db.insertObject(row);
      const object = builder["publicObject"](row);
      io.emit("world:place", { object });
      audit.event("place", p.name, p.userId ?? p.id, `${p.name} 放置了 ${object.kind}`, { objectId: object.id });
      ack?.({ ok: true, object });
    }
  );

  /** 删除道具：只有创建者本人可以拆自己的造物 */
  socket.on("remove", ({ id }: { id: string }, ack?: (res: { ok: boolean; reason?: string }) => void) => {
    const p = playerId ? presence.get(playerId) : null;
    if (!p || !id) return ack?.({ ok: false, reason: "参数无效" });
    const o = world.objects.get(String(id));
    if (!o) return ack?.({ ok: false, reason: "造物不存在" });
    const ownerKey = p.userId ? `u:${p.userId}` : p.id;
    if (o.creatorId !== ownerKey) return ack?.({ ok: false, reason: "只能拆除自己创建的造物哦" });
    world.removeObject(o.id);
    db.deleteObject(o.id);
    io.emit("world:remove", { id: o.id, by: p.id });
    audit.event("remove", p.name, p.userId ?? p.id, `${p.name} 拆除了 ${o.kind}`, { objectId: o.id });
    ack?.({ ok: true });
  });

  socket.on("aiBuild", async ({ brief }: { brief: string }) => {
    const p = playerId ? presence.get(playerId) : null;
    if (!p) return;
    const text = String(brief ?? "").trim();
    if (!text) return;
    const creatorId = p.userId ? `u:${p.userId}` : p.id;
    await builder.tryBuild(text.slice(0, 60), creatorId, p.name, { x: p.x, z: p.z }, p.rotY);
  });

  socket.on("chat", ({ text }: { text: string }) => {
    const p = playerId ? presence.get(playerId) : null;
    if (!p) return;
    const t = String(text ?? "").trim();
    if (!t) return;
    io.emit("chat", {
      id: randomUUID(),
      kind: "player",
      from: p.name,
      fromId: p.id,
      text: t.slice(0, 120),
      ts: Date.now(),
    });
    db.insertChatLog("player", p.name, p.userId ?? p.id, t.slice(0, 120));
  });

  socket.on("disconnect", () => {
    if (!playerId) return;
    const p = presence.get(playerId);
    playerId = null;
    if (!p) return;
    dwellOffline(p); // 小人原地驻留为离线状态，同身份再上线原地复活
  });

  // ---------- 房间（office） ----------
  socket.on("room:join", (_payload: unknown, ack?: (h: RoomHello | { ok: false; reason: string }) => void) => {
    const p = playerId ? presence.get(playerId) : null;
    if (!p) return ack?.({ ok: false, reason: "未加入世界" });
    if (p.roomId) return ack?.({ ok: false, reason: "已在房间内" });
    // 进房：记录户外位置，坐标切到房间门口
    presence.setRoom(p.id, OFFICE_ROOM_ID, { x: 2.7, y: 0, z: 6.4 });
    // 让户外同伴移除自己的远程分身
    emitSameSpace({ ...p, roomId: null } as Player, "player:leave", { id: p.id, name: p.name });
    // 房间内成员收到新玩家
    const members = presence.playersInRoom(OFFICE_ROOM_ID).filter((m) => m.id !== p.id);
    for (const m of members) {
      toSocket(m.socketId, "room:playerJoin", presence.publicInfo(p));
    }
    const hello = officeRoom.hello(
      presence.publicInfo(p),
      members.map((m) => presence.publicInfo(m))
    );
    ack?.(hello);
  });

  socket.on("room:leave", (_payload: unknown, ack?: (res: { ok: boolean; outdoor?: { x: number; y: number; z: number; rotY: number } }) => void) => {
    const p = playerId ? presence.get(playerId) : null;
    if (!p || !p.roomId) return ack?.({ ok: false });
    releasePossessionOnExit(p.id); // 出房间先解除附身
    emitToRoom("playerLeave", { id: p.id });
    const outdoor = p.outdoor ?? { x: 128.5, y: 14, z: 128.5, rotY: 0 };
    presence.setRoom(p.id, null);
    // 回到户外：通知附近户外玩家自己的存在（远程分身重建）
    emitSameSpace(p, "player:join", presence.publicInfo(p));
    ack?.({ ok: true, outdoor });
  });

  socket.on("room:arrived", ({ agentId, orderId }: { agentId: string; orderId: string }) => {
    const p = playerId ? presence.get(playerId) : null;
    if (!p || p.roomId !== OFFICE_ROOM_ID) return;
    officeRoom.onArrived(String(agentId), String(orderId));
  });

  socket.on("room:assign", ({ brief }: { brief: string }) => {
    const p = playerId ? presence.get(playerId) : null;
    if (!p || p.roomId !== OFFICE_ROOM_ID) return;
    const text = String(brief ?? "").trim();
    if (!text) return;
    void officeRoom.assign(text.slice(0, 120), p.id);
  });

  socket.on("room:talkTo", ({ agentId }: { agentId: string }) => {
    const p = playerId ? presence.get(playerId) : null;
    if (!p || p.roomId !== OFFICE_ROOM_ID) return;
    const id = String(agentId ?? "");
    if (!officeRoom.hasAgent(id) || id === "boss") return;
    void officeRoom.talkTo(id, { id: p.id, x: p.x, z: p.z });
  });

  socket.on("room:say", ({ text, agentId }: { text: string; agentId?: string }) => {
    const p = playerId ? presence.get(playerId) : null;
    if (!p || p.roomId !== OFFICE_ROOM_ID) return;
    const t = String(text ?? "").trim();
    if (!t) return;
    const aid = agentId && officeRoom.hasAgent(String(agentId)) ? String(agentId) : undefined;
    db.insertChatLog("player", p.name, p.userId ?? p.id, t.slice(0, 120));
    // 附身中指定自己的员工说话：以员工名义发言，AI 不抢话
    const speakingAsAgent = aid && officeRoom.controllerOf(aid) === p.id ? officeRoom.roster.agents.get(aid) : undefined;
    const fromName = speakingAsAgent ? `${speakingAsAgent.name}(${p.name})` : p.name;
    // 老板的话进房间聊天流（其余成员；发送者客户端已本地回显，避免双条）
    for (const m of presence.playersInRoom(OFFICE_ROOM_ID)) {
      if (m.id === p.id) continue;
      toSocket(m.socketId, "chat", {
        id: randomUUID(),
        kind: "player",
        from: fromName,
        fromId: p.id,
        text: t.slice(0, 120),
        ts: Date.now(),
      });
    }
    if (speakingAsAgent) return; // 附身发言到此为止（不触发老板台词链）
    void officeRoom.bossSpeak(p.id, t.slice(0, 120), aid, { id: p.id, x: p.x, z: p.z });
  });

  // ---------- 附身（以员工视角操控） ----------

  socket.on("room:possess", ({ agentId }: { agentId: string }, ack?: (res: { ok: boolean; reason?: string }) => void) => {
    const p = playerId ? presence.get(playerId) : null;
    const fail = (reason: string) => ack?.({ ok: false, reason });
    if (!p || p.roomId !== OFFICE_ROOM_ID) return fail("要进办公室才能附身");
    if (!p.userId) return fail("游客不能附身（登录后雇佣自己的员工）");
    const reason = officeRoom.possess(String(agentId ?? ""), { id: p.id, userId: p.userId, name: p.name });
    if (reason) return fail(reason);
    ack?.({ ok: true });
  });

  socket.on("room:release", (_payload: unknown, ack?: (res: { ok: boolean; reason?: string }) => void) => {
    const p = playerId ? presence.get(playerId) : null;
    if (!p) return ack?.({ ok: false, reason: "未加入世界" });
    const reason = officeRoom.releaseByPlayer(p.id);
    ack?.(reason ? { ok: false, reason } : { ok: true });
  });

  socket.on("room:agentMove", ({ agentId, x, z, rotY, anim }: { agentId: string; x: number; z: number; rotY: number; anim: "idle" | "walk" }) => {
    const p = playerId ? presence.get(playerId) : null;
    if (!p || p.roomId !== OFFICE_ROOM_ID) return;
    const id = String(agentId ?? "");
    if (!officeRoom.agentMove(id, p.id, Number(x), Number(z))) return;
    if (typeof rotY !== "number" || !Number.isFinite(rotY)) return;
    // 转发给房间其他成员（操控方本地已驱动自己的画面）
    for (const m of presence.playersInRoom(OFFICE_ROOM_ID)) {
      if (m.id === p.id) continue;
      toSocket(m.socketId, "room:agentMove", { agentId: id, x, z, rotY, anim: anim === "walk" ? "walk" : "idle" });
    }
  });
});

// ---------- 后台实时通道（socket.io 命名空间 /admin） ----------
const adminNs = io.of("/admin");
adminNs.use((sock, next) => {
  // 握手校验：token 有效 + 实时查库角色仍是 admin
  const token = (sock.handshake.auth as { token?: string } | undefined)?.token ?? "";
  const payload = verifyToken(token);
  if (!payload) return next(new Error("未登录"));
  const user = db.findUserById(payload.uid);
  if (!user || user.banned || user.role !== "admin") return next(new Error("需要管理员权限"));
  (sock.data as { adminId?: string }).adminId = user.id;
  next();
});
adminNs.on("connection", (sock) => {
  sock.join("admins");
  console.log(`[admin] console connected: ${sock.id}`);
  // 推一次快照
  sock.emit("admin:players", playersSnapshot());
  sock.emit("admin:stats", { online: presence.players.size, ts: Date.now() });
});
/** 在线玩家快照（后台实时列表） */
function playersSnapshot() {
  return [...presence.players.values()].map((p) => ({
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
}
audit.setPush((ev, payload) => adminNs.to("admins").emit(ev, payload));
// 在线人数与玩家列表定时推送
setInterval(() => {
  adminNs.to("admins").emit("admin:stats", { online: presence.players.size, ts: Date.now() });
  adminNs.to("admins").emit("admin:players", playersSnapshot());
}, 5000).unref();

httpServer.listen(PORT, () => {
  console.log(`[world3d] server listening on http://localhost:${PORT}`);
});
