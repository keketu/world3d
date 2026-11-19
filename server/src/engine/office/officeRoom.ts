// Office 房间实例：名册 + 编排器 + 状态查询的门面（跑在 world3d server 进程内）
// P3 演进：外部开发者房间实现同款接口，由网关按 roomType 代理
import { DOOR, PlayerInfo, RoomHello } from "@world3d/shared";
import { Db } from "../../db.js";
import { OfficeRoster } from "./roster.js";
import { Orchestrator } from "./orchestrator.js";

export const OFFICE_ROOM_ID = "office-1";

export class OfficeRoom {
  roomId = OFFICE_ROOM_ID;
  roster = new OfficeRoster();
  orch: Orchestrator;
  private db: Db;
  private emitToRoom: (ev: string, payload: unknown) => void = () => {};

  constructor(db: Db) {
    this.db = db;
    this.orch = new Orchestrator(this.roster, db);
    // agent 活动状态变化 → 房间广播
    this.roster.onChange = (a) => this.emitToRoom("agent:updated", a);
  }

  /** 房间内广播器由 index.ts 提供（按 presence.roomId 路由到具体 socket） */
  attach(emitToRoom: (ev: string, payload: unknown) => void) {
    this.emitToRoom = emitToRoom;
    this.orch.attach({ emit: (ev, payload) => emitToRoom(ev, payload) });
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

  assign(brief: string) {
    return this.orch.assignProject(brief);
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
