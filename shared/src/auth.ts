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
