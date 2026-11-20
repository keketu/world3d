// 土地权 REST：申请（/api/me/land/*）+ 审批（州长/管理员，/api/land/decide、/api/admin/land/*）
// 权限实时查库：admin 看 users.role，州长看 governors 表
import type { Express, Request } from "express";
import { randomUUID } from "node:crypto";
import type { Db } from "./db.js";
import type { Presence } from "./engine/presence.js";
import { verifyToken } from "./auth.js";
import { plotBounds, plotIdAt, listPlots } from "@world3d/shared";
import type { Audit } from "./audit.js";

interface LandDeps {
  db: Db;
  presence: Presence;
  io: { emit: (ev: string, payload: unknown) => void };
  toSocket: (socketId: string, event: string, payload: unknown) => void;
  adminFromReq: (req: Request) => { id: string; name: string; role: string } | null;
  audit: Audit;
}

export function registerLandApi(app: Express, deps: LandDeps) {
  const { db, presence, io, toSocket, adminFromReq, audit } = deps;

  /** token → 有效用户（实时查库，不信 token 里的旧 role） */
  const me = (req: Request): { id: string; name: string; role: string } | null => {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    const payload = verifyToken(token);
    if (!payload) return null;
    const user = db.findUserById(payload.uid);
    if (!user || user.banned) return null;
    return { id: user.id, name: user.name, role: user.role };
  };

  /** 审批通过：落归属 + 状态 + 通知申请人（在线 toast / 离线系统公告） */
  const grant = (appId: string, reviewer: { id: string; name: string }) => {
    const appRow = db.getLandApp(appId);
    if (!appRow || appRow.status !== "pending") return { ok: false, reason: "申请不存在或已处理" };
    const plot = db.getPlot(appRow.plotId);
    if (plot) return { ok: false, reason: `该地块已被 ${plot.ownerName} 认领` };
    // 归属 key 与 place 校验一致：u:<userId>（登录用户跨会话稳定）
    db.setPlotOwner(appRow.plotId, appRow.state, `u:${appRow.applicantId}`, appRow.applicantName);
    db.setLandAppStatus(appId, "approved", reviewer.id, reviewer.name);
    audit.audit(reviewer.id, reviewer.name, "土地审批", "land", appId, `批准 ${appRow.applicantName} 的 ${appRow.plotId}`);
    audit.event("land", reviewer.name, reviewer.id, `批准了 ${appRow.applicantName} 对 ${appRow.plotId} 的土地申请`);
    const applicant = presence.findByUserId(appRow.applicantId);
    if (applicant) toSocket(applicant.socketId, "land:decided", { ok: true, plotId: appRow.plotId, state: appRow.state });
    io.emit("chat", { kind: "system", from: "土地局", text: `🗺️ ${appRow.applicantName} 的土地申请已通过（${appRow.plotId}）` });
    return { ok: true };
  };

  const reject = (appId: string, reviewer: { id: string; name: string }, reason: string) => {
    const appRow = db.getLandApp(appId);
    if (!appRow || appRow.status !== "pending") return { ok: false, reason: "申请不存在或已处理" };
    db.setLandAppStatus(appId, "rejected", reviewer.id, reviewer.name);
    audit.audit(reviewer.id, reviewer.name, "土地审批", "land", appId, `拒绝 ${appRow.applicantName} 的 ${appRow.plotId}`);
    const applicant = presence.findByUserId(appRow.applicantId);
    if (applicant) toSocket(applicant.socketId, "land:decided", { ok: false, plotId: appRow.plotId, state: appRow.state, reason });
    return { ok: true };
  };

  // ---------- 玩家侧 ----------

  /** 我的土地：地块 / 申请记录 / 我治理的州 */
  app.get("/api/me/land", (req, res) => {
    const user = me(req);
    if (!user) return res.status(401).json({ ok: false, reason: "请先登录" });
    const ownerKey = `u:${user.id}`;
    res.json({
      ok: true,
      plots: db.listPlots().filter((p) => p.ownerId === ownerKey),
      apps: db.listLandApps().filter((a) => a.applicantId === user.id).slice(0, 30),
      governed: db.listGovernors().filter((g) => g.userId === user.id),
      /** 我可审批的待审申请（州长 = 本州；管理员 = 全部） */
      pending: db
        .listLandApps("pending")
        .filter((a) => user.role === "admin" || db.getGovernor(a.state)?.userId === user.id)
        .filter((a) => a.applicantId !== user.id),
    });
  });

  /** 申请脚下/指定地块（需登录；游客不可申请） */
  app.post("/api/me/land/apply", (req, res) => {
    const user = me(req);
    if (!user) return res.status(401).json({ ok: false, reason: "土地申请需要注册账号登录" });
    const { plotId, reason } = req.body ?? {};
    const bounds = typeof plotId === "string" ? plotBounds(plotId) : null;
    if (!bounds) return res.json({ ok: false, reason: "地块编号无效" });
    // 用 zoneAt 的等价校验：州必须存在且不是广场/公园（plotBounds 只接受 1..3，广场/公园再排除）
    const state = String(plotId).split("#")[0];
    if (db.getGovernor(state)?.userId === user.id) return res.json({ ok: false, reason: "你是本州州长，无需申请本州土地" });
    if (db.getPlot(String(plotId))) return res.json({ ok: false, reason: `该地块已被 ${db.getPlot(String(plotId))!.ownerName} 认领` });
    const myPending = db.listLandApps("pending").filter((a) => a.applicantId === user.id);
    if (myPending.length >= 2) return res.json({ ok: false, reason: "你已有 2 个待审批的申请，先等等吧" });
    if (myPending.some((a) => a.plotId === plotId)) return res.json({ ok: false, reason: "这块地你已经在申请中了" });
    const id = `landapp-${randomUUID().slice(0, 12)}`;
    db.createLandApp(id, String(plotId), state, user.id, user.name, String(reason ?? "").slice(0, 80));
    audit.event("land", user.name, user.id, `申请了地块 ${plotId}`);
    // 本州州长在线 → 直接提醒
    const gov = db.getGovernor(state);
    if (gov) {
      const gp = presence.findByUserId(gov.userId);
      if (gp) toSocket(gp.socketId, "land:apply", { ok: true, plotId, applicantName: user.name });
    }
    res.json({ ok: true, id });
  });

  // ---------- 州长 / 管理员审批 ----------

  app.post("/api/land/decide", (req, res) => {
    const user = me(req);
    if (!user) return res.status(401).json({ ok: false, reason: "请先登录" });
    const { appId, decision, reason } = req.body ?? {};
    const appRow = db.getLandApp(String(appId ?? ""));
    if (!appRow || appRow.status !== "pending") return res.json({ ok: false, reason: "申请不存在或已处理" });
    const isAdmin = user.role === "admin";
    const gov = db.getGovernor(appRow.state);
    const isGov = gov?.userId === user.id;
    if (!isAdmin && !isGov) return res.status(403).json({ ok: false, reason: "只有本州州长或管理员能审批" });
    if (appRow.applicantId === user.id && !isAdmin) return res.status(403).json({ ok: false, reason: "不能审批自己的申请（请联系管理员）" });
    if (decision === "approved") {
      const r = grant(String(appId), user);
      return res.json(r);
    }
    const r = reject(String(appId), user, String(reason ?? "未通过审批"));
    res.json(r);
  });

  // ---------- 管理员 ----------

  app.get("/api/admin/land", (req, res) => {
    const admin = adminFromReq(req);
    if (!admin) return res.status(403).json({ ok: false, reason: "需要管理员权限" });
    res.json({
      ok: true,
      plots: listPlots().map((p) => ({ ...p, ...(db.getPlot(p.plotId) ?? { ownerId: "", ownerName: "", grantedAt: 0 }) })),
      apps: db.listLandApps(),
      governors: db.listGovernors(),
    });
  });

  app.post("/api/admin/land/decide", (req, res) => {
    const admin = adminFromReq(req);
    if (!admin) return res.status(403).json({ ok: false, reason: "需要管理员权限" });
    const { appId, decision, reason } = req.body ?? {};
    const r = decision === "approved" ? grant(String(appId ?? ""), admin) : reject(String(appId ?? ""), admin, String(reason ?? "管理员驳回"));
    res.json(r);
  });

  app.post("/api/admin/land/governor", (req, res) => {
    const admin = adminFromReq(req);
    if (!admin) return res.status(403).json({ ok: false, reason: "需要管理员权限" });
    const { state, userId, userName, remove } = req.body ?? {};
    if (!/^[1-3]-[1-3]$/.test(String(state ?? ""))) return res.status(400).json({ ok: false, reason: "州编号无效" });
    if (remove) {
      db.removeGovernor(String(state));
      audit.audit(admin.id, admin.name, "任命州长", "land", String(state), `罢免 ${state} 州长`);
      return res.json({ ok: true });
    }
    if (!userId) return res.status(400).json({ ok: false, reason: "缺少 userId" });
    const user = db.findUserById(String(userId));
    if (!user) return res.json({ ok: false, reason: "用户不存在" });
    db.setGovernor(String(state), user.id, user.name, admin.name);
    audit.audit(admin.id, admin.name, "任命州长", "land", String(state), `任命 ${user.name} 为 ${state} 州长`);
    const gp = presence.findByUserId(user.id);
    if (gp) toSocket(gp.socketId, "land:governor", { ok: true, state });
    res.json({ ok: true });
  });

  /** 坐标 → 地块与「观看者」的建造许可（摆道具落点预览用；带 token 则返回 viewer 视角） */
  app.get("/api/land/at", (req, res) => {
    const x = Number(req.query.x);
    const z = Number(req.query.z);
    const plotId = plotIdAt(x, z);
    const plot = plotId ? db.getPlot(plotId) : null;
    // 带有效 token 时额外给 viewer 视角：canBuild 与一致的原因文案
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    const payload = token ? verifyToken(token) : null;
    const user = payload ? db.findUserById(payload.uid) : null;
    let viewer: { canBuild: boolean; reason: string } | null = null;
    if (plotId) {
      const ownerKey = user ? `u:${user.id}` : null;
      const isOwner = !!plot && !!ownerKey && plot.ownerId === ownerKey;
      const isAdmin = !!user && !user.banned && user.role === "admin";
      const isGov = !!user && !!db.getGovernor(plot?.state ?? "")?.userId === true && db.getGovernor(plot?.state ?? "")?.userId === user!.id;
      if (!plot) viewer = { canBuild: false, reason: "这块地还没批——在「🗺 土地」面板申请后就能盖了" };
      else if (isOwner || isAdmin || isGov) viewer = { canBuild: true, reason: "" };
      else viewer = { canBuild: false, reason: `该地块已被 ${plot.ownerName} 认领` };
    }
    res.json({ ok: true, plotId, plot, viewer });
  });
}
