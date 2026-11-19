// 后台 API 客户端（沿用原语义：body.ok 判断成功，不看 HTTP 状态）
import type {
  AdminChatRow,
  AdminOverview,
  AdminUserRow,
  AuditRow,
  GlobalSearchHit,
  PlayerRow,
  SystemInfo,
} from "@world3d/shared";

export const TOKEN_KEY = "w3d_token";

export interface ApiRes<T> {
  ok: boolean;
  reason?: string;
  [k: string]: unknown;
}

export async function api<T = ApiRes<unknown>>(
  path: string,
  token: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  try {
    return (await res.json()) as T;
  } catch {
    return { ok: false, reason: `HTTP ${res.status}` } as T;
  }
}

export const post = <T = ApiRes<unknown>>(path: string, token: string, body: unknown) =>
  api<T>(path, token, { method: "POST", body: JSON.stringify(body) });

export const del = <T = ApiRes<unknown>>(path: string, token: string) =>
  api<T>(path, token, { method: "DELETE" });

/* ---------- 各接口返回类型 ---------- */

export interface UsersRes {
  ok: boolean;
  users: AdminUserRow[];
  total: number;
}
export interface ObjectsRes {
  ok: boolean;
  objects: Array<{
    id: string;
    kind: string;
    variant: string;
    x: number;
    z: number;
    rotY: number;
    creatorId: string;
    creatorName: string;
    createdAt: number;
  }>;
  total: number;
  kinds: Array<{ label: string; value: number }>;
}
export interface ChatRes {
  ok: boolean;
  logs: AdminChatRow[];
}
export interface PlayersRes {
  ok: boolean;
  players: PlayerRow[];
}
export interface AuditRes {
  ok: boolean;
  audits: AuditRow[];
  total: number;
}
export interface SystemRes {
  ok: boolean;
  info: SystemInfo;
  logs: Array<{ id?: number; ts: number; level: string; text: string }>;
}
export interface SearchRes {
  ok: boolean;
  hits: GlobalSearchHit[];
}
export interface OverviewRes {
  ok: boolean;
  overview: AdminOverview;
}
export interface UserDetailRes {
  ok: boolean;
  reason?: string;
  user: {
    id: string;
    name: string;
    role: string;
    banned: boolean;
    createdAt: number;
    lastLoginAt: number | null;
  };
  online: { x: number; z: number; roomId: string | null } | null;
  objects: Array<{ id: string; kind: string; variant: string; x: number; z: number; creatorName: string; createdAt: number }>;
  chats: AdminChatRow[];
}

export const fmtTime = (ts: number | null | undefined) =>
  ts ? new Date(ts).toLocaleString("zh-CN", { hour12: false }) : "—";
export const fmtShort = (ts: number | null | undefined) =>
  ts ? new Date(ts).toLocaleTimeString("zh-CN", { hour12: false }) : "—";
export const fmtAgo = (ts: number | null | undefined) => {
  if (!ts) return "—";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}秒前`;
  if (s < 3600) return `${Math.floor(s / 60)}分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)}小时前`;
  return `${Math.floor(s / 86400)}天前`;
};
export const fmtBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};
export const fmtDuration = (sec: number) => {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d}天 ${h}小时`;
  if (h) return `${h}小时 ${m}分`;
  return `${m}分钟`;
};
