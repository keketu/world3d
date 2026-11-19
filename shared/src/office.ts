// P2 房间实例：office 房间的布局常量、类型与 socket 事件族
// 移植自 office3d（无头分离架构：服务端编排器发 AgentOrder，客户端哑渲染 + 本地 A*）

// ---------- 房间布局（室内坐标：x -13..13，z -9..9，地面 y=0） ----------

export const ROOM = {
  width: 26,
  depth: 18,
  wallHeight: 3.2,
};

export interface Spot {
  x: number;
  z: number;
  rotY: number;
}

export interface DeskSpot {
  id: string;
  desk: Spot;
  seat: Spot;
  standPoint: Spot;
}

// 员工工位：双排棋盘式交错，面对面
export const EMPLOYEE_DESKS: DeskSpot[] = [
  {
    id: "desk-e1",
    desk: { x: -9, z: -2.2, rotY: 0 },
    seat: { x: -9, z: -1.35, rotY: Math.PI },
    standPoint: { x: -9, z: -0.35, rotY: Math.PI },
  },
  {
    id: "desk-e2",
    desk: { x: -4.5, z: -2.2, rotY: 0 },
    seat: { x: -4.5, z: -1.35, rotY: Math.PI },
    standPoint: { x: -4.5, z: -0.35, rotY: Math.PI },
  },
  {
    id: "desk-e3",
    desk: { x: 0, z: -2.2, rotY: 0 },
    seat: { x: 0, z: -1.35, rotY: Math.PI },
    standPoint: { x: 0, z: -0.35, rotY: Math.PI },
  },
  {
    id: "desk-e4",
    desk: { x: -6.75, z: 2.2, rotY: Math.PI },
    seat: { x: -6.75, z: 3.05, rotY: 0 },
    standPoint: { x: -6.75, z: 4.0, rotY: 0 },
  },
  {
    id: "desk-e5",
    desk: { x: -2.25, z: 2.2, rotY: Math.PI },
    seat: { x: -2.25, z: 3.05, rotY: 0 },
    standPoint: { x: -2.25, z: 4.0, rotY: 0 },
  },
];

// 个人 agent 加座：北排 2 席 + 南排 4 席（玩家雇佣的员工坐这里，固定 5 员工满了才用）
export const EXTRA_DESKS: DeskSpot[] = [
  {
    id: "desk-x1",
    desk: { x: 2.25, z: -2.2, rotY: 0 },
    seat: { x: 2.25, z: -1.35, rotY: Math.PI },
    standPoint: { x: 2.25, z: -0.35, rotY: Math.PI },
  },
  {
    id: "desk-x2",
    desk: { x: 11.25, z: -2.2, rotY: 0 },
    seat: { x: 11.25, z: -1.35, rotY: Math.PI },
    standPoint: { x: 11.25, z: -0.35, rotY: Math.PI },
  },
  {
    id: "desk-x3",
    desk: { x: 2.25, z: 2.2, rotY: Math.PI },
    seat: { x: 2.25, z: 3.05, rotY: 0 },
    standPoint: { x: 2.25, z: 4.0, rotY: 0 },
  },
  {
    id: "desk-x4",
    desk: { x: 6.75, z: 2.2, rotY: Math.PI },
    seat: { x: 6.75, z: 3.05, rotY: 0 },
    standPoint: { x: 6.75, z: 4.0, rotY: 0 },
  },
  {
    id: "desk-x5",
    desk: { x: 11.25, z: 2.2, rotY: Math.PI },
    seat: { x: 11.25, z: 3.05, rotY: 0 },
    standPoint: { x: 11.25, z: 4.0, rotY: 0 },
  },
  {
    id: "desk-x6",
    desk: { x: -10.75, z: 2.2, rotY: Math.PI },
    seat: { x: -10.75, z: 3.05, rotY: 0 },
    standPoint: { x: -10.75, z: 4.0, rotY: 0 },
  },
];

// 个人 agent（我的员工）限制
export const PERSONAL_ROOM_CAP = EXTRA_DESKS.length; // 房间内个人员工总席位（6）
export const AGENTS_PER_USER = 4; // 每个账号最多雇佣数
/** 个人员工可选角色（不含老板/PM） */
export const PERSONAL_ROLES: AgentRole[] = ["product", "design", "frontend", "backend", "qa"];
/** 个人员工代表色（colorIdx 索引） */
export const PERSONAL_PALETTE = ["#e8618c", "#5b8def", "#3aa981", "#d08a2e", "#9a6ee2", "#38a2b5"];

// PM 工位
export const PM_SPOT: DeskSpot = {
  id: "desk-pm",
  desk: { x: 6.5, z: -2.2, rotY: 0 },
  seat: { x: 6.5, z: -1.35, rotY: Math.PI },
  standPoint: { x: 6.5, z: -0.35, rotY: Math.PI },
};

// 老板：西北角独立办公位
export const BOSS_SPOT: DeskSpot = {
  id: "desk-boss",
  desk: { x: -10, z: -6.2, rotY: 0 },
  seat: { x: -10, z: -5.35, rotY: Math.PI },
  standPoint: { x: -10, z: -4.3, rotY: Math.PI },
};

// 会议室：东北角圆桌 + 6 座
export const MEETING = {
  table: { x: 9.5, z: -5.5, radius: 1.7 },
  seats: Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    return {
      id: `meet-${i}`,
      x: 9.5 + Math.cos(a) * 2.35,
      z: -5.5 + Math.sin(a) * 2.35,
      rotY: Math.atan2(-Math.cos(a) * 2.35, -Math.sin(a) * 2.35),
    };
  }),
};

// 咖啡角
export const COFFEE = {
  machine: { x: 11.2, z: 5.5 },
  standPoint: { x: 10.2, z: 5.5, rotY: -Math.PI / 2 },
};

// 门（南墙中部）——玩家进出点
export const DOOR = { x: 0, z: 8.4 };

// 障碍物（寻路 + 玩家碰撞）：矩形 [xMin, zMin, xMax, zMax]
function deskRect(cx: number, cz: number): [number, number, number, number] {
  const hw = 1.1;
  const hd = 0.45;
  return [cx - hw, cz - hd, cx + hw, cz + hd];
}

export const OBSTACLES: Array<[number, number, number, number]> = [
  ...[...EMPLOYEE_DESKS, ...EXTRA_DESKS, PM_SPOT].map((d) => deskRect(d.desk.x, d.desk.z)),
  [-11.3, -6.7, -8.7, -5.7], // 老板大桌
  [9.5 - 1.7, -5.5 - 1.7, 9.5 + 1.7, -5.5 + 1.7], // 会议圆桌
  [10.4, 4.6, 12.2, 6.4], // 咖啡吧台
  [-1.2, 6.2, 2.2, 7.6], // 沙发区
  [-12.5, 8.0, -11.9, 8.6], // 绿植
  [12.0, 8.0, 12.6, 8.6],
  [-12.5, -8.6, -11.9, -8.0],
  [3.2, -8.6, 3.8, -8.0],
  [5.4, 7.8, 6.0, 8.4],
  [-2.2, -8.5, -0.2, -7.9], // 打印机柜
];

// 白板（西墙）
export const WHITEBOARD = { x: -12.8, z: 2.0, rotY: Math.PI / 2 };

// ---------- Office 类型 ----------

export type AgentRole = "boss" | "pm" | "product" | "design" | "frontend" | "backend" | "qa";

export type AgentActivity = "idle" | "walking" | "talking" | "working" | "meeting" | "coffee";

export interface AgentInfo {
  id: string;
  name: string;
  role: AgentRole;
  /** 角色代表色（渲染用） */
  color: string;
  personality: string;
  activity: AgentActivity;
  currentTask?: string;
  currentProjectId?: string;
  /** 个人 agent 专属：雇佣者账号 id（固定员工无此字段） */
  ownerId?: string;
  /** 雇主昵称（展示用） */
  ownerName?: string;
  /** 正被哪位玩家附身操控（playerId；null/未定义 = AI 自主） */
  controlledBy?: string | null;
  /** 工位 id（客户端落座定位用） */
  deskId?: string;
}

export interface ProjectInfo {
  id: string;
  name: string;
  brief: string;
  status: "queued" | "planning" | "in_progress" | "meeting" | "reporting" | "done" | "paused";
  createdAt: number;
  finishedAt?: number;
}

export interface TaskInfo {
  id: string;
  projectId: string;
  title: string;
  assigneeId?: string;
  status: "pending" | "assigned" | "in_progress" | "done";
  order: number;
  startedAt?: number;
  endsAt?: number;
}

export interface DialogueLine {
  id: string;
  ts: number;
  projectId?: string;
  agentId: string;
  toAgentId?: string;
  text: string;
  kind: "boss" | "discuss" | "meeting" | "report" | "ambient" | "system";
  holdMs: number;
}

// ---------- Agent 订单（服务端 → 客户端角色系统） ----------

export interface WalkOrder {
  orderId: string;
  type: "walk";
  agentId: string;
  x: number;
  z: number;
  faceTo?: { x: number; z: number };
}

export interface SitOrder {
  orderId: string;
  type: "sitAt";
  agentId: string;
  x: number;
  z: number;
  rotY: number;
}

export interface StandOrder {
  orderId: string;
  type: "standUp";
  agentId: string;
  faceTo?: { x: number; z: number };
}

export interface AnimOrder {
  orderId: string;
  type: "anim";
  agentId: string;
  anim: "idle" | "work" | "talk" | "type" | "sit";
}

export interface FaceOrder {
  orderId: string;
  type: "face";
  agentId: string;
  to: { x: number; z: number };
}

export type AgentOrder = WalkOrder | SitOrder | StandOrder | AnimOrder | FaceOrder;

export interface ArrivedEvent {
  agentId: string;
  orderId: string;
}

// ---------- 附身（以员工视角操控） ----------

/** 附身中的 agent 实时位置（操控方 → 服务端 → 房间其他成员） */
export interface AgentMoveEvent {
  agentId: string;
  x: number;
  z: number;
  rotY: number;
  anim: "idle" | "walk";
}

// ---------- 房间 socket 事件（world3d 连接上的 room:* 事件族） ----------

/** 服务端 → 进入者个人：房间全量状态 */
export interface RoomHello {
  roomId: string;
  roomType: "office"; // P3 外部房间扩展用
  spawn: { x: number; z: number; rotY: number };
  /** 同房间其他玩家（房间坐标） */
  players: PlayerInfo[];
  agents: AgentInfo[];
  projects: ProjectInfo[];
  tasks: TaskInfo[];
  dialogues: DialogueLine[];
}

/** 服务端 → 房间内成员：有玩家进出/状态变化 */
export interface RoomPlayerInfo extends PlayerInfo {
  /* 房间坐标的玩家位置（复用 PlayerInfo 字段） */
}

import type { PlayerInfo } from "./protocol.js";
export type { PlayerInfo };

// 房间内广播事件名（客户端收到的都带 room: 前缀）
// room:hello / room:playerJoin / room:playerLeave / room:agent(updated)
// room:order / room:dialogue / room:project / room:task / room:progress
// room:notify / room:meeting(started|ended)
// room:agentRemoved（个人 agent 被解雇移出房间）/ room:agentMove（附身中的位置同步）
// 客户端 → 服务端：room:join / room:leave / room:arrived / room:assign / room:say
//                room:possess / room:release / room:agentMove（附身操控）
