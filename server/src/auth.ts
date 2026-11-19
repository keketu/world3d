// 账号认证：scrypt 密码哈希 + HMAC 令牌（JWT-lite）+ 登录限速
// 全部 node:crypto，零依赖。密钥持久化在 data/ 下（部署时不覆盖 data/）
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Request, Response, NextFunction } from "express";
import { AuthUser, UserRole } from "@world3d/shared";

const SCRYPT_N = 8192; // 单次 ~30ms / 32MB，登录瞬间才跑
const TOKEN_DAYS = 30;

// ---------- 密钥 ----------

let secret: Buffer;

export function initAuth(dataDir: string) {
  fs.mkdirSync(dataDir, { recursive: true });
  const keyPath = path.join(dataDir, "secret.key");
  if (fs.existsSync(keyPath)) {
    secret = Buffer.from(fs.readFileSync(keyPath, "utf8").trim(), "hex");
  } else {
    secret = randomBytes(32);
    fs.writeFileSync(keyPath, secret.toString("hex"), { mode: 0o600 });
  }
}

// ---------- 密码 ----------

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, { N: SCRYPT_N, r: 8, p: 1 });
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const hash = scryptSync(password, Buffer.from(saltHex, "hex"), 32, { N: SCRYPT_N, r: 8, p: 1 });
  const expected = Buffer.from(hashHex, "hex");
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}

// ---------- 令牌 ----------

interface TokenPayload {
  uid: string;
  name: string;
  role: UserRole;
  exp: number;
}

const b64u = (buf: Buffer | string) => Buffer.from(buf).toString("base64url");
const unb64u = (s: string) => Buffer.from(s, "base64url");

export function issueToken(user: AuthUser): string {
  const payload: TokenPayload = {
    uid: user.id,
    name: user.name,
    role: user.role,
    exp: Date.now() + TOKEN_DAYS * 86400_000,
  };
  const body = b64u(JSON.stringify(payload));
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyToken(token: string | null | undefined): TokenPayload | null {
  if (!token || !secret) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expect = createHmac("sha256", secret).update(body).digest();
  const got = unb64u(sig);
  if (got.length !== expect.length || !timingSafeEqual(got, expect)) return null;
  try {
    const payload = JSON.parse(unb64u(body).toString("utf8")) as TokenPayload;
    if (typeof payload.uid !== "string" || typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------- Express 辅助 ----------

export interface AuthedRequest extends Request {
  auth?: TokenPayload;
}

export function authFromReq(req: AuthedRequest): TokenPayload | null {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  const payload = verifyToken(token);
  if (payload) req.auth = payload;
  return payload;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  if (authFromReq(req)) next();
  else res.status(401).json({ ok: false, reason: "请先登录" });
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  const p = authFromReq(req);
  if (p?.role === "admin") next();
  else res.status(403).json({ ok: false, reason: p ? "需要管理员权限" : "请先登录" });
}

// ---------- 登录/注册限速：每 IP 12 次/分钟（scrypt 单次 ~30ms，12 次=0.36s/分钟 CPU，防刷足够） ----------

const attempts = new Map<string, number[]>();

export function loginRateOk(ip: string): boolean {
  const now = Date.now();
  const list = (attempts.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (list.length >= 12) {
    attempts.set(ip, list);
    return false;
  }
  list.push(now);
  attempts.set(ip, list);
  return true;
}
