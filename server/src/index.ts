import express from "express";
import { createServer } from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Server, Socket } from "socket.io";
import { randomUUID } from "node:crypto";
import { HelloPayload, MoveInput, PlayerInfo, RoomHello, WorldObject, PROP_KINDS } from "@world3d/shared";
import { World } from "./engine/world.js";
import { Db } from "./db.js";
import { Presence, Player } from "./engine/presence.js";
import { Builder } from "./engine/builder.js";
import { OfficeRoom, OFFICE_ROOM_ID } from "./engine/office/officeRoom.js";

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

const db = new Db();
const world = new World();
const presence = new Presence();
const builder = new Builder(world, db);
const officeRoom = new OfficeRoom(db);

// 重放持久化数据
for (const mod of db.loadMods()) world.mods.set(mod.id, { ...mod });
for (const o of db.loadObjects()) world.objects.set(o.id, { ...o, params: (o.params ?? {}) as Record<string, unknown> });

// 办公楼造物（出生区旁固定位置，boot 时确保存在）
const OFFICE_BUILDING = { kind: "office", variant: "小世界科技", x: 118, z: 114, rotY: 0.62, doorDist: 4.6 };
if (![...world.objects.values()].some((o) => o.kind === "office")) {
  const row = world.addObject(
    {
      kind: OFFICE_BUILDING.kind,
      variant: OFFICE_BUILDING.variant,
      x: OFFICE_BUILDING.x,
      z: OFFICE_BUILDING.z,
      rotY: OFFICE_BUILDING.rotY,
      scale: 1,
      creatorId: "system",
      creatorName: "小世界",
      createdAt: Date.now(),
      params: { doorDist: OFFICE_BUILDING.doorDist },
    },
    { doorDist: OFFICE_BUILDING.doorDist }
  );
  db.insertObject(row);
}

const toSocket = (socketId: string, event: string, payload: unknown) => {
  io.to(socketId).emit(event, payload);
};
presence.attach(io, toSocket);
builder.attach(io);

/** 编排器事件名 → 客户端 room:* 事件名映射 */
const ROOM_EVENT_MAP: Record<string, string> = {
  "agent:order": "room:order",
  "agent:updated": "room:agent",
  "dialogue:line": "room:dialogue",
  "project:updated": "room:project",
  "task:updated": "room:task",
  "task:progress": "room:progress",
  "notify": "room:notify",
  "meeting:started": "room:meeting:started",
  "meeting:ended": "room:meeting:ended",
};

/** 房间内广播：发给所有在该房间的玩家 */
const emitToRoom = (ev: string, payload: unknown) => {
  const wired = ROOM_EVENT_MAP[ev] ?? `room:${ev}`;
  for (const p of presence.playersInRoom(OFFICE_ROOM_ID)) toSocket(p.socketId, wired, payload);
};
officeRoom.attach(emitToRoom);
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

// ---------- REST ----------
app.get("/api/state", (_req, res) => {
  res.json({
    players: [...presence.players.values()].map((p) => presence.publicInfo(p)),
    objects: db.loadObjects(),
    mods: db.loadMods(),
  });
});

// ---------- Socket ----------
io.on("connection", (socket: Socket) => {
  let playerId: string | null = null;

  socket.on("join", ({ name }: { name: string }, ack?: (h: HelloPayload) => void) => {
    const safeName = String(name ?? "").slice(0, 12) || `旅人_${socket.id.slice(0, 4)}`;
    const spawn = world.findSpawn();
    const player = presence.join(safeName, socket.id, spawn);
    playerId = player.id;

    const hello: HelloPayload = {
      meta: world.publicMeta(),
      selfId: player.id,
      self: presence.publicInfo(player),
      // 只发同空间（户外）的玩家，房间内玩家的坐标是房间局部坐标，跨空间会出鬼影
      players: [...presence.players.values()]
        .filter((p) => p.id !== player.id && p.roomId === player.roomId)
        .map((p) => presence.publicInfo(p)),
      objects: [...world.objects.values()],
      terrainMods: [...world.mods.values()],
    };
    ack?.(hello);

    io.emit("chat", {
      id: randomUUID(),
      kind: "system",
      from: "系统",
      text: `👋 ${safeName} 进入了世界`,
      ts: Date.now(),
    });
    emitSameSpace(player, "player:join", presence.publicInfo(player));
  });

  socket.on("move", (mv: MoveInput) => {
    if (!playerId) return;
    if (typeof mv?.x !== "number" || typeof mv?.z !== "number") return;
    presence.updateMove(playerId, mv);
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
      const row = world.addObject(
        {
          kind,
          variant,
          x,
          z,
          rotY: Number(payload?.rotY ?? 0),
          scale: 1,
          creatorId: p.id,
          creatorName: p.name,
          createdAt: Date.now(),
          params: {},
        },
        {}
      );
      db.insertObject(row);
      const object = builder["publicObject"](row);
      io.emit("world:place", { object });
      ack?.({ ok: true, object });
    }
  );

  /** 删除道具：只有创建者本人可以拆自己的造物 */
  socket.on("remove", ({ id }: { id: string }, ack?: (res: { ok: boolean; reason?: string }) => void) => {
    const p = playerId ? presence.get(playerId) : null;
    if (!p || !id) return ack?.({ ok: false, reason: "参数无效" });
    const o = world.objects.get(String(id));
    if (!o) return ack?.({ ok: false, reason: "造物不存在" });
    if (o.creatorId !== p.id) return ack?.({ ok: false, reason: "只能拆除自己创建的造物哦" });
    world.removeObject(o.id);
    db.deleteObject(o.id);
    io.emit("world:remove", { id: o.id, by: p.id });
    ack?.({ ok: true });
  });

  socket.on("aiBuild", async ({ brief }: { brief: string }) => {
    const p = playerId ? presence.get(playerId) : null;
    if (!p) return;
    const text = String(brief ?? "").trim();
    if (!text) return;
    await builder.tryBuild(text.slice(0, 60), p.id, p.name, { x: p.x, z: p.z }, p.rotY);
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
  });

  socket.on("disconnect", () => {
    if (!playerId) return;
    const p = presence.leave(playerId);
    if (p) {
      if (p.roomId) emitToRoom("playerLeave", { id: p.id });
      emitSameSpace(p, "player:leave", { id: p.id, name: p.name });
      io.emit("chat", {
        id: randomUUID(),
        kind: "system",
        from: "系统",
        text: `🚪 ${p.name} 离开了世界`,
        ts: Date.now(),
      });
    }
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
    void officeRoom.assign(text.slice(0, 120));
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
    void officeRoom.bossSpeak(p.id, t.slice(0, 120), aid);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[world3d] server listening on http://localhost:${PORT}`);
});
