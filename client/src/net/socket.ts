import { io, Socket } from "socket.io-client";
import {
  AiDonePayload,
  AiProgressPayload,
  ChatMessage,
  HelloPayload,
  MoveInput,
  PlacePayload,
  PlayerInfo,
  RemovePayload,
  RoomHello,
  SnapshotPayload,
  SculptPayload,
  WorldObject,
} from "@world3d/shared";
import { useWorld } from "../state/store";
import { clientWorld } from "../engine/world";
import { charSystem } from "../scene/office/agentSystem";
import { roomHost } from "../engine/roomHost";

let socket: Socket | null = null;

function handleHello(h: HelloPayload) {
  const s = useWorld.getState();
  s.setMeta(h.meta);
  s.setPlayers(h.players);
  useWorld.setState({ selfId: h.selfId, objects: h.objects });
  clientWorld.configure(h.meta);
  clientWorld.seedObjects(h.objects, h.terrainMods);
  // 防御：若早到的 player:join 已把「自己」当远程玩家建了分身，这里清掉
  clientWorld.removeRemote(h.selfId);
  // hello.players = 你加入前就在场的玩家（他们不会再发 player:join）——补建远程角色
  for (const p of h.players) clientWorld.addRemote(p);
  clientWorld.onHello();
}

export function connect(): Socket {
  if (socket) return socket;
  socket = io("/", { transports: ["websocket", "polling"] });

  socket.on("connect", () => useWorld.getState().setConnected(true));
  socket.on("disconnect", () => useWorld.getState().setConnected(false));

  socket.on("hello", handleHello);

  socket.on("snapshot", (snap: SnapshotPayload) => {
    useWorld.getState().setPlayers(snap.players);
    clientWorld.onSnapshot(snap.players);
  });

  socket.on("world:place", (p: PlacePayload) => {
    clientWorld.applyPlaced(p.object);
    const s = useWorld.getState();
    s.addObject(p.object);
  });

  socket.on("world:remove", (p: RemovePayload) => {
    clientWorld.applyRemoved(p.id);
  });

  socket.on("world:sculpt", (p: SculptPayload) => {
    clientWorld.applySculpt(p.mod);
  });

  socket.on("player:join", (p: PlayerInfo) => {
    // io.emit 会把新玩家的 join 广播回自己——过滤，否则渲染出自己的分身
    if (p.id === useWorld.getState().selfId) return;
    clientWorld.addRemote(p);
  });

  socket.on("player:leave", (p: { id: string }) => {
    clientWorld.removeRemote(p.id);
  });

  socket.on("chat", (m: ChatMessage) => {
    useWorld.getState().pushChat(m);
  });

  socket.on("object:added", (o: WorldObject) => {
    useWorld.getState().addObject(o);
  });

  socket.on("ai:progress", (_p: AiProgressPayload) => {
    if (!useWorld.getState().aiBusy) useWorld.setState({ aiBusy: true });
  });

  socket.on("ai:done", (_p: AiDonePayload) => {
    useWorld.setState({ aiBusy: false });
  });

  // ---------- office 房间 ----------
  socket.on("room:playerJoin", (p) => {
    clientWorld.addRemote(p);
  });

  socket.on("room:playerLeave", ({ id }: { id: string }) => {
    clientWorld.removeRemote(id);
  });

  socket.on("room:agent", (a) => {
    roomHost.updateAgent(a);
  });

  socket.on("room:order", (o) => {
    charSystem.push(o);
  });

  socket.on("room:dialogue", (l) => {
    useWorld.getState().pushRoomDialogue(l);
    roomHost.showBubble(l.agentId, l.text, l.holdMs);
  });

  socket.on("room:project", (p) => {
    useWorld.getState().upsertProject(p);
  });

  socket.on("room:task", (t) => {
    useWorld.getState().upsertTask(t);
  });

  socket.on("room:progress", ({ taskId, startedAt, endsAt }: { taskId: string; startedAt: number; endsAt: number }) => {
    useWorld.getState().setProgress(taskId, startedAt, endsAt);
  });

  socket.on("room:notify", ({ text }: { text: string }) => {
    useWorld.getState().pushToast(text);
  });

  socket.on("room:meeting:started", () => {
    useWorld.getState().pushToast("📢 全员会议开始");
  });

  socket.on("room:meeting:ended", () => {
    useWorld.getState().pushToast("✅ 会议结束");
  });

  return socket;
}

export function sendRoomJoin() {
  socket?.emit("room:join", {}, (h: RoomHello | { ok: false; reason: string }) => {
    if (h && typeof h === "object" && "ok" in h && (h as { ok: false }).ok === false) {
      useWorld.getState().pushToast((h as { reason: string }).reason);
      return;
    }
    roomHost.enterWithHello(h as RoomHello);
  });
}

export function sendRoomLeave() {
  socket?.emit("room:leave", {}, (res: { ok: boolean; outdoor?: { x: number; y: number; z: number; rotY: number } }) => {
    if (res?.ok && res.outdoor) roomHost.exitTo(res.outdoor);
  });
}

export function sendRoomArrived(agentId: string, orderId: string) {
  socket?.emit("room:arrived", { agentId, orderId });
}

export function sendRoomTalkTo(agentId: string) {
  socket?.emit("room:talkTo", { agentId });
}

export function sendRoomAssign(brief: string) {
  socket?.emit("room:assign", { brief });
}

export function sendRoomSay(text: string, agentId?: string) {
  socket?.emit("room:say", agentId ? { text, agentId } : { text });
}

export function join(name: string, onHello: (h: HelloPayload) => void) {
  if (!socket) connect();
  socket!.emit("join", { name }, (h: HelloPayload) => {
    handleHello(h); // ack 与事件两条路径统一处理
    useWorld.getState().setJoined(name);
    onHello(h);
  });
}

export function sendMove(mv: MoveInput) {
  socket?.emit("move", mv);
}

export function requestPlace(
  payload: { kind: string; variant: string; x: number; z: number; rotY?: number },
  cb?: (ok: boolean, reason?: string) => void
) {
  socket?.emit("place", payload, (res: { ok: boolean; reason?: string }) => cb?.(res.ok, res.reason));
}

export function requestRemove(id: string, cb?: (ok: boolean, reason?: string) => void) {
  socket?.emit("remove", { id }, (res: { ok: boolean; reason?: string }) => cb?.(res.ok, res.reason));
}

export function sendAiBuild(brief: string) {
  socket?.emit("aiBuild", { brief });
}

export function sendChat(text: string) {
  socket?.emit("chat", { text });
}
