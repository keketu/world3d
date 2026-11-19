// 账号系统协议类型（P3 用户系统）
export type UserRole = "user" | "admin";

export interface AuthUser {
  id: string;
  name: string;
  role: UserRole;
  createdAt: number;
}

export type AuthResponse = { ok: true; token: string; user: AuthUser } | { ok: false; reason: string };

/** 后台用户行（含管理字段） */
export interface AdminUserRow {
  id: string;
  name: string;
  role: UserRole;
  banned: boolean;
  createdAt: number;
  lastLoginAt: number | null;
  online: boolean;
}

export interface AdminStats {
  users: number;
  todayNewUsers: number;
  online: number;
  objects: number;
  projects: number;
  latestRoot: { root: string; count: number; createdAt: number } | null;
}

/** 造物权属存证信息 */
export interface ObjectProof {
  objectId: string;
  creatorId: string;
  createdAt: number;
  sig: string;
  valid: boolean;
}

/* ---------- 后台控制台类型 ---------- */

/** 趋势点（按日） */
export interface TrendPoint {
  day: string;
  users: number;
  objects: number;
  chats: number;
}

/** 在线人数点（按分钟） */
export interface OnlinePoint {
  minute: number;
  count: number;
}

/** 类型分布项 */
export interface DistItem {
  label: string;
  value: number;
}

/** 总览聚合 */
export interface AdminOverview {
  users: number;
  todayNewUsers: number;
  online: number;
  guestsOnline: number;
  objects: number;
  todayNewObjects: number;
  chatsToday: number;
  projects: number;
  chatRate: number;
  trends: TrendPoint[];
  onlineTrend: OnlinePoint[];
  objectKinds: DistItem[];
  topCreators: DistItem[];
  latestRoot: { root: string; count: number; createdAt: number } | null;
}

/** 在线玩家行 */
export interface PlayerRow {
  id: string;
  name: string;
  userId: string | null;
  isGuest: boolean;
  x: number;
  z: number;
  roomId: string | null;
  joinedAt: number;
  lastMove: number;
}

/** 审计行 */
export interface AuditRow {
  id: number;
  ts: number;
  adminId: string;
  adminName: string;
  action: string;
  targetType: string;
  targetId: string;
  detail: string;
}

/** 事件流行 */
export interface EventRow {
  id: number;
  ts: number;
  kind: string;
  actor: string;
  actorId: string;
  text: string;
}

/** 系统信息 */
export interface SystemInfo {
  uptime: number;
  startedAt: number;
  memory: { rss: number; heapUsed: number; heapTotal: number; system: number };
  cpu: number;
  node: string;
  platform: string;
  dbSize: number;
  counts: Record<string, number>;
}

/** 全局搜索命中 */
export interface GlobalSearchHit {
  type: "user" | "object" | "chat";
  id: string;
  title: string;
  sub: string;
  ts: number;
}

/** 批量操作结果 */
export interface BulkResult {
  ok: boolean;
  affected: number;
  failed?: number;
  reason?: string;
}

/** 聊天记录行 */
export interface AdminChatRow {
  id: number;
  ts: number;
  kind: string;
  from: string;
  fromId: string;
  text: string;
}
