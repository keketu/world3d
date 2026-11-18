// 前后端共享的 socket 协议与类型（低模道具版世界）

export interface WorldMeta {
  size: number;
  seed: number;
  waterLevel: number;
}

export interface PlayerInfo {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  z: number;
  rotY: number;
  anim: "idle" | "walk";
}

/** 一件造物（道具）：世界里可放置的「物」，天然带创建者 */
export interface WorldObject {
  id: string;
  kind: string; // tree / flower / house / fence / path / pond
  variant: string;
  x: number;
  z: number;
  rotY: number;
  scale: number;
  creatorId: string;
  creatorName: string;
  createdAt: number;
  params?: Record<string, unknown>;
}

/** 地形雕塑（如挖池塘造成的凹陷） */
export interface TerrainMod {
  id: string;
  type: "pond";
  x: number;
  z: number;
  r: number;
  depth: number;
  by: string;
}

export interface ChatMessage {
  id: string;
  kind: "player" | "ai" | "system";
  from: string;
  fromId?: string;
  text: string;
  ts: number;
}

// ---------- 事件 ----------

export interface HelloPayload {
  meta: WorldMeta;
  selfId: string;
  self: PlayerInfo;
  players: PlayerInfo[];
  objects: WorldObject[];
  terrainMods: TerrainMod[];
}

export interface MoveInput {
  x: number;
  y: number;
  z: number;
  rotY: number;
  anim: "idle" | "walk";
}

export interface SnapshotPayload {
  t: number;
  players: PlayerInfo[];
}

/** 服务端广播：新道具已放置 */
export interface PlacePayload {
  object: WorldObject;
}

export interface RemovePayload {
  id: string;
  by: string;
}

/** 地形雕塑（挖池塘） */
export interface SculptPayload {
  mod: TerrainMod;
}

export interface AiProgressPayload {
  opId: string;
  done: number;
  total: number;
  brief: string;
}

export interface AiDonePayload {
  opId: string;
  ok: boolean;
  summary: string;
  objectIds: string[];
}
