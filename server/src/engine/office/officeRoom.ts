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
      spawn: { x: DOOR.x, z: 6.4, rotY: Math.PI }, // 门内侧，面朝房间深处（离门 2m，避免立即弹「离开」）
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

  bossSay(text: string) {
    return this.orch.bossChatter(text);
  }

  onArrived(agentId: string, orderId: string) {
    this.orch.onArrived(agentId, orderId);
  }
}
