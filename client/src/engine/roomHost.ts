// P2 房间宿主：户外场景 ↔ office 室内场景的无缝切换器
// 单渲染器：进房隐藏户外组、挂载室内组；agent 由 charSystem（本地 A*）驱动
// 附身模式：玩家操控自己的员工——self 幽灵移动，agent 身体镜像跟随，其他人经服务端转发看到
import * as THREE from "three";
import { RoomHello, AgentInfo, DOOR, AgentMoveEvent } from "@world3d/shared";
import { useWorld } from "../state/store";
import { buildOfficeRoom, roomBlocked } from "../scene/office/room";
import { createOfficeAgent, animateOfficeAgent, OfficeAgentRig } from "../scene/office/agents";
import { charSystem, setArrivedEmitter } from "../scene/office/agentSystem";
import { sendRoomArrived, sendRoomJoin, sendRoomLeave, sendRoomTalkTo, sendRoomPossess, sendRoomRelease, sendAgentMove } from "../net/socket";
import { clientWorld } from "./world";

interface LabelApi {
  setLabel(id: string, html: string, wx: number, wy: number, wz: number, cls?: string, maxDist?: number): void;
  removeLabel(id: string): void;
}

interface OutdoorRefs {
  terrain: THREE.Object3D | null;
  water: THREE.Object3D | null;
  propGroup: THREE.Object3D | null;
  highlightRing: THREE.Object3D | null;
}

interface HostDeps {
  scene: THREE.Scene;
  fog: THREE.Fog;
  labels: LabelApi;
  setSelf: (x: number, y: number, z: number, rotY?: number) => void;
  getSelf: () => { x: number; y: number; z: number; rotY: number };
  getCamDist: () => number;
  setCamDist: (d: number) => void;
  setCamPitch: (p: number) => void;
  outdoor: OutdoorRefs;
}

const ROOM_DIST_MIN = 4;
const ROOM_DIST_MAX = 12;

class RoomHost {
  active = false;
  /** 附身中的员工 id（null = 正常操控自己） */
  possessedId: string | null = null;
  private deps: HostDeps | null = null;
  private roomGroup: THREE.Group | null = null;
  /** 房间实体网格（房间模式下作为点击射线目标） */
  solidMesh: THREE.Mesh | null = null;
  private roomLights: THREE.PointLight[] = [];
  private rigRoot: THREE.Group | null = null;
  private rigs = new Map<string, { rig: OfficeAgentRig; info: AgentInfo }>();
  private bubbles = new Map<string, number>(); // agentId -> until
  /** 别人附身操控的员工：服务端转发的目标位置（本地平滑跟随） */
  private remoteMoves = new Map<string, { x: number; z: number; rotY: number; anim: "idle" | "walk"; ts: number }>();
  private savedFog: { near: number; far: number } | null = null;
  private savedCamDist = 13;
  private moveTimer = 0;
  /** 办公楼门口的世界坐标（由 game.ts 根据造物位置更新） */
  doorWorld: { x: number; z: number } | null = null;

  init(deps: HostDeps) {
    this.deps = deps;
    setArrivedEmitter(({ agentId, orderId }) => sendRoomArrived(agentId, orderId));
  }

  /** 办公楼造物就位后由 game.ts 调用 */
  setDoorWorld(x: number, z: number) {
    this.doorWorld = { x, z };
  }

  get doorPrompt(): "enter" | "leave" | null {
    if (!this.deps) return null;
    const s = this.deps.getSelf();
    if (!this.active) {
      if (!this.doorWorld) return null;
      return Math.hypot(s.x - this.doorWorld.x, s.z - this.doorWorld.z) < 2.2 ? "enter" : null;
    }
    return Math.hypot(s.x - DOOR.x, s.z - DOOR.z) < 1.5 ? "leave" : null;
  }

  /** 按 E / 点按钮：执行门口动作 */
  doorAction() {
    const prompt = this.doorPrompt;
    if (prompt === "enter") this.requestEnter();
    else if (prompt === "leave") this.requestLeave();
  }

  requestEnter() {
    if (this.active) return;
    sendRoomJoin();
  }

  requestLeave() {
    if (!this.active) return;
    sendRoomLeave();
  }

  /** 房间移动碰撞（玩家行走用） */
  movementBlocked(x: number, z: number): boolean {
    return roomBlocked(x, z);
  }

  cameraDistRange(): [number, number] {
    return this.active ? [ROOM_DIST_MIN, ROOM_DIST_MAX] : [5, 30];
  }

  // ---------- 附身（以员工视角操控） ----------

  /** E 键 / 按钮：附身面前自己的空闲员工 */
  possessNearby() {
    const near = useWorld.getState().nearOwnAgent;
    if (!near || this.possessedId) return;
    sendRoomPossess(near.id, (ok, reason) => {
      if (!ok) {
        useWorld.getState().pushToast(reason || "附身失败");
        return;
      }
      this.beginPossess(near.id, near.name);
    });
  }

  private beginPossess(agentId: string, name: string) {
    if (!this.active) return;
    this.possessedId = agentId;
    charSystem.takeover(agentId); // 清 AI 订单，身体归玩家
    // self 幽灵挪到员工脚下，操控即从 TA 的位置开始
    const st = charSystem.states.get(agentId);
    if (st && this.deps) this.deps.setSelf(st.x, 0, st.z, st.rotY);
    useWorld.getState().setPossessAgent({ id: agentId, name });
    useWorld.getState().pushToast(`🎭 已化身 ${name}（WASD/点击移动，聊天=以 TA 名义说话）`);
  }

  /** 结束附身：身体停在原地，AI 带员工回工位 */
  release() {
    if (!this.possessedId) return;
    sendRoomRelease(() => this.endPossess());
  }

  private endPossess() {
    if (!this.possessedId) return;
    this.possessedId = null;
    useWorld.getState().setPossessAgent(null);
  }

  // ---------- 进入 ----------

  enterWithHello(h: RoomHello) {
    if (!this.deps || this.active) return;
    const { scene, fog, labels } = this.deps;

    // 室内组（首次构建，之后复用）
    if (!this.roomGroup) {
      this.roomGroup = buildOfficeRoom();
      this.solidMesh = (this.roomGroup.getObjectByName("officeSolid") as THREE.Mesh) ?? null;
      scene.add(this.roomGroup);
      for (const lx of [-6, 0, 6]) {
        const l = new THREE.PointLight(0xfff2dd, 0.7, 18);
        l.position.set(lx, 2.6, 0);
        scene.add(l);
        this.roomLights.push(l);
      }
      this.rigRoot = new THREE.Group();
      scene.add(this.rigRoot);
    }
    this.roomGroup.visible = true;
    this.rigRoot!.visible = true;
    for (const l of this.roomLights) l.visible = true;

    // 隐藏户外
    const o = this.deps.outdoor;
    if (o.terrain) o.terrain.visible = false;
    if (o.water) o.water.visible = false;
    if (o.propGroup) o.propGroup.visible = false;
    if (o.highlightRing) o.highlightRing.visible = false;

    // 雾关掉（室内不需要）
    this.savedFog = { near: fog.near, far: fog.far };
    fog.near = 90;
    fog.far = 180;

    // 相机拉近 + 高角度俯视（房间无顶、南墙开敞，俯视才不穿墙；office3d 同款视角）
    this.savedCamDist = this.deps.getCamDist();
    this.deps.setCamDist(9);
    this.deps.setCamPitch(1.02);

    // 清掉户外远程玩家，播种房间内玩家（坐标是房间局部坐标）
    clientWorld.clearRemotes();
    for (const p of h.players) clientWorld.addRemote(p);

    // agent 状态机 + rigs
    charSystem.hydrate(h.agents);
    for (const a of h.agents) this.ensureRig(a);
    for (const [id] of this.rigs) {
      if (!h.agents.some((a) => a.id === id)) this.removeRig(id);
    }

    // 自身放到门口
    this.deps.setSelf(h.spawn.x, 0, h.spawn.z, h.spawn.rotY);

    // 状态入库
    const st = useWorld.getState();
    st.setOfficeState(h.agents, h.projects, h.tasks, h.dialogues);
    st.setInRoom(true, h.roomId);
    st.pushToast("🏢 已进入 小世界科技 办公室");
    this.active = true;
    void labels;
  }

  /** 房间：离开（服务端 ack 后由 socket 层调） */
  exitTo(outdoor: { x: number; y: number; z: number; rotY: number }) {
    if (!this.deps || !this.active) return;
    const { fog, labels } = this.deps;

    if (this.roomGroup) this.roomGroup.visible = false;
    if (this.rigRoot) this.rigRoot.visible = false;
    for (const l of this.roomLights) l.visible = false;
    const o = this.deps.outdoor;
    if (o.terrain) o.terrain.visible = true;
    if (o.water) o.water.visible = true;
    if (o.propGroup) o.propGroup.visible = true;
    if (o.highlightRing) o.highlightRing.visible = false;

    if (this.savedFog) {
      fog.near = this.savedFog.near;
      fog.far = this.savedFog.far;
      this.savedFog = null;
    }
    this.deps.setCamDist(this.savedCamDist);

    clientWorld.clearRemotes();
    this.deps.setSelf(outdoor.x, outdoor.y, outdoor.z, outdoor.rotY);

    // 清 agent 标签
    for (const id of this.rigs.keys()) {
      labels.removeLabel(`agent-${id}`);
      labels.removeLabel(`bubble-${id}`);
    }
    this.bubbles.clear();
    this.remoteMoves.clear();
    this.endPossess(); // 出房间必然解除附身（服务端也会兜底）

    const st = useWorld.getState();
    st.setInRoom(false, null);
    st.pushToast("🌸 回到了小世界");
    this.active = false;
  }

  /** 服务器广播玩家离开房间时，自己也恰好在房内 → 修正远程列表由 socket 层处理 */

  // ---------- agent rigs ----------

  private ensureRig(info: AgentInfo) {
    if (!this.rigRoot) return;
    let entry = this.rigs.get(info.id);
    if (!entry) {
      const rig = createOfficeAgent(info);
      this.rigRoot.add(rig.root);
      entry = { rig, info };
      this.rigs.set(info.id, entry);
    } else {
      entry.info = info;
    }
  }

  private removeRig(id: string) {
    const e = this.rigs.get(id);
    if (!e || !this.rigRoot) return;
    this.rigRoot.remove(e.rig.root);
    this.rigs.delete(id);
  }

  /** room:agent 广播：更新 info（活动/任务/附身）；新面孔入座；改名换色重建 rig */
  updateAgent(a: AgentInfo) {
    const e = this.rigs.get(a.id);
    if (e && (e.info.name !== a.name || e.info.color !== a.color || e.info.role !== a.role)) {
      this.removeRig(a.id);
      this.ensureRig(a);
    } else if (!e) {
      this.ensureRig(a);
      charSystem.hydrate([a]); // 新员工直接坐在自己的工位
    }
    const entry = this.rigs.get(a.id);
    if (entry) entry.info = a;
    charSystem.infos.set(a.id, a);
    useWorld.getState().upsertAgent(a);
    if (!a.controlledBy) this.remoteMoves.delete(a.id);
    // 服务端强制解除了我们的附身（断线兜底 / 员工被解雇）
    if (this.possessedId === a.id && !a.controlledBy) this.endPossess();
  }

  /** room:agentRemoved：员工被解雇离场 */
  removeAgent(id: string) {
    if (!this.deps) return;
    this.removeRig(id);
    this.deps.labels.removeLabel(`agent-${id}`);
    this.deps.labels.removeLabel(`bubble-${id}`);
    charSystem.drop(id);
    this.remoteMoves.delete(id);
    useWorld.getState().removeAgent(id);
    if (this.possessedId === id) this.endPossess();
  }

  /** 房间内玩家的远程分身（由 socket room:playerJoin/leave 驱动，同 clientWorld.remotes 主管线） */

  showBubble(agentId: string, text: string, holdMs: number) {
    this.bubbles.set(agentId, Date.now() + holdMs + 600);
  }

  /** 别人附身操控的员工：服务端转发的位置 → 本地平滑跟随 */
  remoteAgentMove(m: AgentMoveEvent) {
    this.remoteMoves.set(m.agentId, { x: m.x, z: m.z, rotY: m.rotY, anim: m.anim, ts: Date.now() });
  }

  // ---------- 每帧 ----------

  update(dt: number, time: number) {
    if (!this.active || !this.deps) return;
    const { labels } = this.deps;

    charSystem.update(Math.min(dt, 0.05));
    const now = Date.now();
    let near: { id: string; name: string } | null = null;
    let nearD = Infinity;
    let nearOwn: { id: string; name: string } | null = null;
    let nearOwnD = Infinity;
    const self = this.deps.getSelf();
    const myUserId = useWorld.getState().auth.user?.id ?? null;
    for (const [id, entry] of this.rigs) {
      const st = charSystem.states.get(id);
      if (!st) continue;
      // 附身中：员工身体镜像 self 的移动（操控端）；别人附身：平滑跟随服务端转发位置
      if (this.possessedId === id) {
        st.x = self.x;
        st.z = self.z;
        st.y = 0;
        st.rotY = self.rotY;
        st.seated = false;
      } else {
        const rm = this.remoteMoves.get(id);
        if (rm) {
          const k = Math.min(1, dt * 10);
          st.x += (rm.x - st.x) * k;
          st.z += (rm.z - st.z) * k;
          const d = ((rm.rotY - st.rotY + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
          st.rotY += d * k;
          st.anim = Math.hypot(rm.x - st.x, rm.z - st.z) > 0.12 ? "walk" : rm.anim === "walk" ? "walk" : "idle";
          st.seated = false;
          st.y = 0;
        }
      }
      animateOfficeAgent(entry.rig, st, entry.info, time);
      const tag = entry.info.controlledBy ? `${entry.info.name} 🎭` : entry.info.name;
      labels.setLabel(`agent-${id}`, tag, st.x, st.y + 1.15, st.z, "nameTag", 40);
      if (this.possessedId !== id) {
        const dist = Math.hypot(st.x - self.x, st.z - self.z);
        if (dist < 2.4 && dist < nearD) {
          nearD = dist;
          near = { id, name: entry.info.name };
        }
        // 自己雇佣的空闲员工在附近 → 可附身
        if (
          myUserId &&
          entry.info.ownerId === myUserId &&
          !entry.info.controlledBy &&
          entry.info.activity === "idle" &&
          dist < 2.6 &&
          dist < nearOwnD
        ) {
          nearOwnD = dist;
          nearOwn = { id, name: entry.info.name };
        }
      }
      const until = this.bubbles.get(id);
      if (until && until > now) {
        const bubble = this.bubbleHtml(entry.info, now);
        labels.setLabel(`bubble-${id}`, bubble, st.x, st.y + 1.62, st.z, "objTag", 40);
      } else {
        if (until) this.bubbles.delete(id);
        labels.removeLabel(`bubble-${id}`);
      }
    }
    // 最近 agent / 可附身员工变化才写 store（避免每帧触发渲染）
    const st = useWorld.getState();
    if (st.nearAgent?.id !== (near?.id ?? null)) st.setNearAgent(near);
    if (st.nearOwnAgent?.id !== (nearOwn?.id ?? null)) st.setNearOwnAgent(nearOwn);

    // 附身中：节流同步所操控员工的位置给服务端（其他人由此看到 TA 在动）
    if (this.possessedId) {
      this.moveTimer += dt;
      if (this.moveTimer >= 0.12) {
        this.moveTimer = 0;
        const cs = charSystem.states.get(this.possessedId);
        if (cs) sendAgentMove(this.possessedId, cs.x, cs.z, cs.rotY, cs.anim === "walk" ? "walk" : "idle");
      }
    }
  }

  /** E 键/按钮：和面前最近的 agent 开聊 */
  talkToNearby() {
    const near = useWorld.getState().nearAgent;
    if (!near) return;
    sendRoomTalkTo(near.id);
    useWorld.getState().setLastTalkAgent({ id: near.id, until: Date.now() + 45_000 });
    useWorld.setState({ roomPanelOpen: false });
  }

  private bubbleHtml(info: AgentInfo, _now: number): string {
    const st = useWorld.getState();
    const line = [...st.roomDialogues].reverse().find((l) => l.agentId === info.id && now() - l.ts < 8000);
    const text = line ? line.text : "";
    return `<span class="objLabel">${emojiOf(info.role)} ${escapeHtml(text)}</span>`;
  }

  /** 调试用：房间组引用 */
  get group() {
    return this.roomGroup;
  }
}

function now() {
  return Date.now();
}

function emojiOf(role: string): string {
  return role === "boss" ? "👔" : role === "pm" ? "📋" : role === "product" ? "📐" : role === "design" ? "🎨" : role === "frontend" ? "💻" : role === "backend" ? "🔧" : "🔍";
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export const roomHost = new RoomHost();
