import express from "express";
import { createServer } from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Server, Socket } from "socket.io";
import { randomUUID } from "node:crypto";
import { HelloPayload, MoveInput, WorldObject, PROP_KINDS } from "@world3d/shared";
import { World } from "./engine/world.js";
import { Db } from "./db.js";
import { Presence } from "./engine/presence.js";
import { Builder } from "./engine/builder.js";

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

// 重放持久化数据
for (const mod of db.loadMods()) world.mods.set(mod.id, { ...mod });
for (const o of db.loadObjects()) world.objects.set(o.id, { ...o, params: (o.params ?? {}) as Record<string, unknown> });

const toSocket = (socketId: string, event: string, payload: unknown) => {
  io.to(socketId).emit(event, payload);
};
presence.attach(io, toSocket);
builder.attach(io);

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
      players: [...presence.players.values()].filter((p) => p.id !== player.id).map((p) => presence.publicInfo(p)),
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
    io.emit("player:join", presence.publicInfo(player));
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
      io.emit("player:leave", { id: p.id, name: p.name });
      io.emit("chat", {
        id: randomUUID(),
        kind: "system",
        from: "系统",
        text: `🚪 ${p.name} 离开了世界`,
        ts: Date.now(),
      });
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`[world3d] server listening on http://localhost:${PORT}`);
});
