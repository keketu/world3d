// Office 房间实例：名册 + 编排器 + 附身管理 + 状态查询的门面（跑在 world3d server 进程内）
// P3 演进：外部开发者房间实现同款接口，由网关按 roomType 代理
import { PlayerInfo, RoomHello, AgentRole, PERSONAL_ROOM_CAP } from "@world3d/shared";
import { Db } from "../../db.js";
import { OfficeRoster, AgentRuntime } from "./roster.js";
import { Orchestrator } from "./orchestrator.js";

export const OFFICE_ROOM_ID = "office-1";

export class OfficeRoom {
  roomId = OFFICE_ROOM_ID;
  roster = new OfficeRoster();
  orch: Orchestrator;
  private db: Db;
  private emitToRoom: (ev: string, payload: unknown) => void = () => {};
  /** agentId → 操控者 playerId（附身表） */
  private possessedBy = new Map<string, string>();

  constructor(db: Db) {
    this.db = db;
    this.orch = new Orchestrator(this.roster, db);
    // agent 活动状态变化 → 房间广播
    this.roster.onChange = (a) => this.emitToRoom("agent:updated", a);
    this.roster.onRemove = (id) => {
      this.possessedBy.delete(id);
      this.emitToRoom("agent:removed", { id });
    };
  }

  /** 房间内广播器由 index.ts 提供（按 presence.roomId 路由到具体 socket） */
  attach(emitToRoom: (ev: string, payload: unknown) => void) {
    this.emitToRoom = emitToRoom;
    this.orch.attach({ emit: (ev, payload) => emitToRoom(ev, payload) });
  }

  /** 个人 agent（我的员工）与库表对齐：新雇的入座、改过的刷新、解雇的离场 */
  syncPersonalAgents() {
    const rows = this.db.listAllAgents();
    // 先移除：库里已删/账号已注销的个人 agent 离场（腾出的工位本次即可复用）
    for (const a of this.roster.personalAgents()) {
      if (!rows.some((r) => r.id === a.id)) this.roster.removePersonal(a.id);
    }
    for (const r of rows) {
      const existing: AgentRuntime | undefined = this.roster.agents.get(r.id);
      if (existing) {
        this.roster.updatePersonal(r.id, {
          name: r.name,
          role: r.role as AgentRole,
          personality: r.personality,
          colorIdx: r.colorIdx,
        });
      } else if (this.roster.personalAgents().length < PERSONAL_ROOM_CAP) {
        this.roster.spawnPersonal({
          id: r.id,
          name: r.name,
          role: r.role as AgentRole,
          personality: r.personality,
          colorIdx: r.colorIdx,
          ownerId: r.ownerId,
          ownerName: r.ownerName ?? "岛主",
        });
      }
    }
  }

  // ---------- 附身（以员工视角操控） ----------

  /** 玩家附身自己的空闲员工：成功返回 null，否则返回拒绝原因 */
  possess(agentId: string, player: { id: string; userId: string | null; name: string }): string | null {
    const a = this.roster.agents.get(agentId);
    if (!a) return "没有这位员工";
    if (!a.ownerId) return "只能附身自己的员工";
    if (a.ownerId !== player.userId) return "这不是你的员工";
    if (a.controlledBy) return "TA 正被操控中";
    if (a.activity !== "idle") return "TA 正忙着呢，等 TA 空闲再附身";
    if (this.possessorOf(player.id)) return "你已经在附身另一位员工了";
    a.controlledBy = player.id;
    a.seated = false;
    this.possessedBy.set(agentId, player.id);
    this.emitToRoom("agent:updated", this.roster.publicInfo(a));
    this.emitToRoom("notify", { text: `🎭 ${player.name} 化身为 ${a.name} 行动` });
    return null;
  }

  /** 结束附身；agent 自己走回工位 */
  releaseByPlayer(playerId: string, quiet = false): string | null {
    const agentId = this.possessorOf(playerId);
    if (!agentId) return "你没有在附身";
    this.clearPossession(agentId, quiet);
    void this.orch.returnHome(agentId);
    return null;
  }

  /** 直接按 agent 解除（agent 被解雇/房间关闭用） */
  releaseAgent(agentId: string) {
    this.clearPossession(agentId, true);
  }

  private clearPossession(agentId: string, quiet: boolean) {
    const a = this.roster.agents.get(agentId);
    const pid = this.possessedBy.get(agentId);
    this.possessedBy.delete(agentId);
    if (!a) return;
    a.controlledBy = null;
    this.emitToRoom("agent:updated", this.roster.publicInfo(a));
    if (!quiet && pid) this.emitToRoom("notify", { text: `↩️ ${a.name} 回到了自己的工位` });
  }

  possessorOf(playerId: string): string | null {
    for (const [agentId, pid] of this.possessedBy) if (pid === playerId) return agentId;
    return null;
  }

  controllerOf(agentId: string): string | null {
    return this.possessedBy.get(agentId) ?? null;
  }

  /** 附身移动合法性：只有操控者能推位置，且不出房间边界 */
  agentMove(agentId: string, playerId: string, x: number, z: number): boolean {
    if (this.possessedBy.get(agentId) !== playerId) return false;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    return Math.abs(x) <= 13 && Math.abs(z) <= 9;
  }

  /** 进入者的全量房间状态 */
  hello(self: PlayerInfo, others: PlayerInfo[]): RoomHello {
    const saved = this.db.loadOfficeState();
    return {
      roomId: this.roomId,
      roomType: "office",
      spawn: { x: 2.7, z: 6.4, rotY: Math.PI }, // 门旁空地（避开沙发障碍区），面朝房间深处
      players: others,
      agents: this.roster.list(),
      projects: saved.projects,
      tasks: saved.tasks,
      dialogues: saved.dialogues,
    };
  }

  assign(brief: string, playerId?: string | null) {
    return this.orch.assignProject(brief, playerId);
  }

  /** 老板走到 agent 面前发起对话 */
  talkTo(agentId: string, player: { id: string; x: number; z: number }) {
    return this.orch.talkTo(agentId, player);
  }

  /** 老板说话：指定/身边的 agent 优先接话，否则 PM 出场 */
  bossSpeak(playerId: string, text: string, agentId?: string, speaker?: { id: string; x: number; z: number }) {
    return this.orch.bossSpeak(playerId, text, agentId, speaker);
  }

  hasAgent(agentId: string) {
    return this.roster.agents.has(agentId);
  }

  onArrived(agentId: string, orderId: string) {
    this.orch.onArrived(agentId, orderId);
  }
}
