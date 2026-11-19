// P2 房间宿主：户外场景 ↔ office 室内场景的无缝切换器
// 单渲染器：进房隐藏户外组、挂载室内组；agent 由 charSystem（本地 A*）驱动
import * as THREE from "three";
import { RoomHello, AgentInfo, DOOR } from "@world3d/shared";
import { useWorld } from "../state/store";
import { buildOfficeRoom, roomBlocked } from "../scene/office/room";
import { createOfficeAgent, animateOfficeAgent, OfficeAgentRig } from "../scene/office/agents";
import { charSystem, setArrivedEmitter } from "../scene/office/agentSystem";
import { sendRoomArrived, sendRoomJoin, sendRoomLeave } from "../net/socket";
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
  private deps: HostDeps | null = null;
  private roomGroup: THREE.Group | null = null;
  /** 房间实体网格（房间模式下作为点击射线目标） */
  solidMesh: THREE.Mesh | null = null;
  private roomLights: THREE.PointLight[] = [];
  private rigRoot: THREE.Group | null = null;
  private rigs = new Map<string, { rig: OfficeAgentRig; info: AgentInfo }>();
  private bubbles = new Map<string, number>(); // agentId -> until
  private savedFog: { near: number; far: number } | null = null;
  private savedCamDist = 13;
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

  /** room:agent 广播：更新 info（活动/任务） */
  updateAgent(a: AgentInfo) {
    const e = this.rigs.get(a.id);
    if (e) e.info = a;
    const st = charSystem.states.get(a.id);
    if (st) charSystem.infos.set(a.id, a);
    useWorld.getState().upsertAgent(a);
  }

  /** 房间内玩家的远程分身（由 socket room:playerJoin/leave 驱动，同 clientWorld.remotes 主管线） */

  showBubble(agentId: string, text: string, holdMs: number) {
    this.bubbles.set(agentId, Date.now() + holdMs + 600);
  }

  // ---------- 每帧 ----------

  update(dt: number, time: number) {
    if (!this.active || !this.deps) return;
    const { labels } = this.deps;

    charSystem.update(Math.min(dt, 0.05));
    const now = Date.now();
    for (const [id, entry] of this.rigs) {
      const st = charSystem.states.get(id);
      if (!st) continue;
      animateOfficeAgent(entry.rig, st, entry.info, time);
      labels.setLabel(`agent-${id}`, entry.info.name, st.x, st.y + 1.15, st.z, "nameTag", 40);
      const until = this.bubbles.get(id);
      if (until && until > now) {
        const bubble = this.bubbleHtml(entry.info, now);
        labels.setLabel(`bubble-${id}`, bubble, st.x, st.y + 1.62, st.z, "objTag", 40);
      } else {
        if (until) this.bubbles.delete(id);
        labels.removeLabel(`bubble-${id}`);
      }
    }
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
