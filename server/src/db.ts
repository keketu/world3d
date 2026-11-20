import BetterSqlite3 from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { AdminUserRow, AuditRow, DialogueLine, EventRow, ProjectInfo, TaskInfo, TerrainMod, WorldObject } from "@world3d/shared";
import { decryptApiKey, maskKey } from "./llm.js";

export interface ChatLogRow {
  id: number;
  ts: number;
  kind: string;
  from: string;
  fromId: string;
  text: string;
}

/** 个人 agent（我的员工）一行：agents JOIN users 带雇主昵称 */
export interface DbAgentRow {
  id: string;
  ownerId: string;
  ownerName: string;
  name: string;
  role: string;
  personality: string;
  colorIdx: number;
  createdAt: number;
}

// SQLite 持久化：道具造物（含创建者） + 地形雕塑 + office 房间（项目/任务/对话）
export class Db {
  private db: BetterSqlite3.Database;
  /** 造物落库钩子（index.ts 挂存证签名） */
  onInsertObject: ((o: WorldObject) => void) | null = null;
  onDeleteObject: ((id: string) => void) | null = null;

  constructor(dataDir = path.resolve("data")) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new BetterSqlite3(path.join(dataDir, "world.db"));
    this.db.pragma("journal_mode = WAL");
    // 旧体素版 schema 迁移：检测到不兼容的旧表则重建（正常启动保留数据）
    const objectsCols = this.db.pragma(`table_info(objects)`) as unknown as Array<{ name: string }>;
    if (objectsCols.length > 0 && !objectsCols.some((c) => c.name === "x")) {
      this.db.exec(`DROP TABLE objects`);
    }
    const modsCols = this.db.pragma(`table_info(terrain_mods)`) as unknown as Array<{ name: string }>;
    if (modsCols.length > 0 && !modsCols.some((c) => c.name === "depth")) {
      this.db.exec(`DROP TABLE terrain_mods`);
    }
    this.db.exec(`DROP TABLE IF EXISTS edits`); // 方块级编辑表已废弃
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS objects (
        id TEXT PRIMARY KEY,
        kind TEXT, variant TEXT,
        x REAL, z REAL, rotY REAL, scale REAL,
        creatorId TEXT, creatorName TEXT,
        createdAt INTEGER,
        params TEXT
      );
      CREATE TABLE IF NOT EXISTS terrain_mods (
        id TEXT PRIMARY KEY,
        type TEXT, x REAL, z REAL, r REAL, depth REAL, by TEXT
      );
      CREATE TABLE IF NOT EXISTS office_projects (
        id TEXT PRIMARY KEY,
        name TEXT, brief TEXT, status TEXT,
        createdAt INTEGER, finishedAt INTEGER
      );
      CREATE TABLE IF NOT EXISTS office_tasks (
        id TEXT PRIMARY KEY,
        projectId TEXT, title TEXT, assigneeId TEXT,
        status TEXT, ord INTEGER
      );
      CREATE TABLE IF NOT EXISTS office_dialogues (
        id TEXT PRIMARY KEY,
        ts INTEGER, projectId TEXT, agentId TEXT, toAgentId TEXT,
        text TEXT, kind TEXT, holdMs INTEGER
      );
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE COLLATE NOCASE,
        passHash TEXT,
        role TEXT NOT NULL DEFAULT 'user',
        createdAt INTEGER,
        lastLoginAt INTEGER,
        banned INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS chat_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER, kind TEXT, sender TEXT, fromId TEXT, text TEXT
      );
      CREATE TABLE IF NOT EXISTS attest_roots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        root TEXT, count INTEGER, createdAt INTEGER
      );
      CREATE TABLE IF NOT EXISTS object_proofs (
        objectId TEXT PRIMARY KEY,
        sig TEXT, signedAt INTEGER
      );
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER, adminId TEXT, adminName TEXT,
        action TEXT, targetType TEXT, targetId TEXT, detail TEXT
      );
      CREATE TABLE IF NOT EXISTS event_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER, kind TEXT, actor TEXT, actorId TEXT, text TEXT, meta TEXT
      );
      CREATE TABLE IF NOT EXISTS user_llm (
        userId TEXT PRIMARY KEY,
        provider TEXT, model TEXT, baseUrl TEXT,
        apiKeyEnc TEXT,
        persona TEXT, temperature REAL,
        enabled INTEGER NOT NULL DEFAULT 1,
        updatedAt INTEGER
      );
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        ownerId TEXT NOT NULL,
        name TEXT, role TEXT, personality TEXT,
        colorIdx INTEGER NOT NULL DEFAULT 0,
        createdAt INTEGER,
        FOREIGN KEY(ownerId) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS player_pos (
        userId TEXT PRIMARY KEY,
        x REAL, y REAL, z REAL, rotY REAL,
        updatedAt INTEGER
      );
      CREATE TABLE IF NOT EXISTS land_plots (
        plotId TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        ownerId TEXT NOT NULL,
        ownerName TEXT,
        grantedAt INTEGER
      );
      CREATE TABLE IF NOT EXISTS land_apps (
        id TEXT PRIMARY KEY,
        plotId TEXT NOT NULL,
        state TEXT NOT NULL,
        applicantId TEXT NOT NULL,
        applicantName TEXT,
        reason TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        reviewerId TEXT,
        reviewerName TEXT,
        reviewedAt INTEGER,
        createdAt INTEGER
      );
      CREATE TABLE IF NOT EXISTS governors (
        state TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        userName TEXT,
        appointedBy TEXT,
        appointedAt INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_land_apps_status ON land_apps(status);
      CREATE INDEX IF NOT EXISTS idx_land_apps_applicant ON land_apps(applicantId);
      CREATE INDEX IF NOT EXISTS idx_chat_ts ON chat_log(ts);
      CREATE INDEX IF NOT EXISTS idx_chat_from ON chat_log(fromId);
      CREATE INDEX IF NOT EXISTS idx_users_created ON users(createdAt);
      CREATE INDEX IF NOT EXISTS idx_objects_creator ON objects(creatorId);
      CREATE INDEX IF NOT EXISTS idx_objects_created ON objects(createdAt);
      CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);
      CREATE INDEX IF NOT EXISTS idx_event_ts ON event_log(ts);
      CREATE INDEX IF NOT EXISTS idx_agents_owner ON agents(ownerId);
    `);
    // office：重启后未完成的项目标记 paused（编排器 attach 时 resume）
    this.db
      .prepare(
        `UPDATE office_projects SET status='paused' WHERE status IN ('queued','planning','in_progress','meeting','reporting')`
      )
      .run();
  }

  insertObject(o: WorldObject & { params?: Record<string, unknown> }) {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO objects (id,kind,variant,x,z,rotY,scale,creatorId,creatorName,createdAt,params)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(o.id, o.kind, o.variant, o.x, o.z, o.rotY, o.scale, o.creatorId, o.creatorName, o.createdAt, JSON.stringify(o.params ?? {}));
    this.onInsertObject?.(o);
  }

  deleteObject(id: string) {
    this.db.prepare(`DELETE FROM objects WHERE id=?`).run(id);
    this.onDeleteObject?.(id);
  }

  /** 搬移造物（出生区迁移时办公楼跟过来） */
  updateObjectParams(id: string, params: Record<string, unknown>) {
    this.db.prepare(`UPDATE objects SET params = ? WHERE id = ?`).run(JSON.stringify(params), id);
  }

  updateObjectPos(id: string, x: number, z: number, rotY: number) {
    this.db.prepare(`UPDATE objects SET x=?, z=?, rotY=? WHERE id=?`).run(x, z, rotY, id);
  }

  /** 读取单条造物行（存证验章以账本为准，不用内存副本——才能发现外部篡改） */
  getObjectRow(id: string): { id: string; creatorId: string; creatorName: string; createdAt: number } | null {
    return (
      (this.db
        .prepare(`SELECT id,creatorId,creatorName,createdAt FROM objects WHERE id=?`)
        .get(id) as { id: string; creatorId: string; creatorName: string; createdAt: number }) ?? null
    );
  }

  insertMod(m: TerrainMod) {
    this.db
      .prepare(`INSERT OR REPLACE INTO terrain_mods (id,type,x,z,r,depth,by) VALUES (?,?,?,?,?,?,?)`)
      .run(m.id, m.type, m.x, m.z, m.r, m.depth, m.by);
  }

  loadObjects(): WorldObject[] {
    const rows = this.db
      .prepare(`SELECT * FROM objects ORDER BY createdAt ASC`)
      .all() as unknown as Array<WorldObject & { params: string }>;
    return rows.map((r) => {
      let params: Record<string, unknown> = {};
      try {
        params = JSON.parse(r.params || "{}");
      } catch {
        params = {};
      }
      return { ...r, params };
    });
  }

  loadMods(): TerrainMod[] {
    return this.db
      .prepare(`SELECT id,type,x,z,r,depth,by FROM terrain_mods ORDER BY rowid ASC`)
      .all() as unknown as TerrainMod[];
  }

  // ---------- office 房间（编排器通过 OfficeDb 接口使用） ----------

  insertProject(p: ProjectInfo) {
    this.db
      .prepare(`INSERT INTO office_projects (id,name,brief,status,createdAt,finishedAt) VALUES (?,?,?,?,?,?)`)
      .run(p.id, p.name, p.brief, p.status, p.createdAt, p.finishedAt ?? null);
  }

  updateProject(p: ProjectInfo) {
    this.db
      .prepare(`UPDATE office_projects SET name=?,brief=?,status=?,finishedAt=? WHERE id=?`)
      .run(p.name, p.brief, p.status, p.finishedAt ?? null, p.id);
  }

  insertTask(t: TaskInfo) {
    this.db
      .prepare(`INSERT INTO office_tasks (id,projectId,title,assigneeId,status,ord) VALUES (?,?,?,?,?,?)`)
      .run(t.id, t.projectId, t.title, t.assigneeId ?? null, t.status, t.order);
  }

  updateTask(t: TaskInfo) {
    this.db
      .prepare(`UPDATE office_tasks SET assigneeId=?,status=? WHERE id=?`)
      .run(t.assigneeId ?? null, t.status, t.id);
  }

  insertDialogue(l: DialogueLine) {
    this.db
      .prepare(
        `INSERT INTO office_dialogues (id,ts,projectId,agentId,toAgentId,text,kind,holdMs) VALUES (?,?,?,?,?,?,?,?)`
      )
      .run(l.id, l.ts, l.projectId ?? null, l.agentId, l.toAgentId ?? null, l.text, l.kind, l.holdMs);
  }

  loadOfficeState(): { projects: ProjectInfo[]; tasks: TaskInfo[]; dialogues: DialogueLine[] } {
    const projects = this.db.prepare(`SELECT * FROM office_projects ORDER BY createdAt ASC`).all() as unknown as ProjectInfo[];
    const tasks = this.db.prepare(`SELECT * FROM office_tasks ORDER BY ord ASC`).all() as unknown as TaskInfo[];
    const dialogues = (
      this.db.prepare(`SELECT * FROM office_dialogues ORDER BY ts DESC LIMIT 200`).all() as unknown as DialogueLine[]
    ).reverse();
    return { projects, tasks, dialogues };
  }

  loadPausedProjects(): Array<{ project: ProjectInfo; tasks: TaskInfo[] }> {
    const projects = this.db
      .prepare(`SELECT * FROM office_projects WHERE status='paused' ORDER BY createdAt ASC`)
      .all() as unknown as ProjectInfo[];
    return projects.map((p) => ({
      project: p,
      tasks: this.db
        .prepare(`SELECT * FROM office_tasks WHERE projectId=? ORDER BY ord ASC`)
        .all(p.id) as unknown as TaskInfo[],
    }));
  }

  // ---------- 账号（users） ----------

  createUser(name: string, passHash: string, role: "user" | "admin"): DbUserRow {
    const id = `u-${randomUUID().slice(0, 8)}`;
    const createdAt = Date.now();
    this.db
      .prepare(`INSERT INTO users (id,name,passHash,role,createdAt,lastLoginAt,banned) VALUES (?,?,?,?,?,?,0)`)
      .run(id, name, passHash, role, createdAt, createdAt);
    return { id, name, passHash, role, createdAt, lastLoginAt: createdAt, banned: 0 };
  }

  findUserByName(name: string): DbUserRow | null {
    return (this.db.prepare(`SELECT * FROM users WHERE name=? COLLATE NOCASE`).get(name) as DbUserRow) ?? null;
  }

  findUserById(id: string): DbUserRow | null {
    return (this.db.prepare(`SELECT * FROM users WHERE id=?`).get(id) as DbUserRow) ?? null;
  }

  countUsers(): number {
    return (this.db.prepare(`SELECT COUNT(*) AS c FROM users`).get() as { c: number }).c;
  }

  listUsers(q: string): Array<Omit<AdminUserRow, "online">> {
    const like = `%${q}%`;
    const rows = this.db
      .prepare(`SELECT id,name,role,createdAt,lastLoginAt,banned FROM users WHERE name LIKE ? ORDER BY createdAt DESC LIMIT 200`)
      .all(like) as unknown as Array<{ id: string; name: string; role: "user" | "admin"; createdAt: number; lastLoginAt: number | null; banned: number }>;
    return rows.map((r) => ({ id: r.id, name: r.name, role: r.role, createdAt: r.createdAt, lastLoginAt: r.lastLoginAt, banned: !!r.banned }));
  }

  setUserRole(id: string, role: "user" | "admin") {
    this.db.prepare(`UPDATE users SET role=? WHERE id=?`).run(role, id);
  }

  setUserBanned(id: string, banned: boolean) {
    this.db.prepare(`UPDATE users SET banned=? WHERE id=?`).run(banned ? 1 : 0, id);
  }

  touchLogin(id: string) {
    this.db.prepare(`UPDATE users SET lastLoginAt=? WHERE id=?`).run(Date.now(), id);
  }

  // ---------- 用户自带大模型（user_llm，API Key 只存密文） ----------

  /** 服务端内部用：读出解密后的完整配置（不含则 null） */
  getLlmConfig(userId: string): {
    provider: string;
    model: string;
    baseUrl: string;
    apiKey: string;
    persona: string;
    temperature: number;
    enabled: boolean;
  } | null {
    const row = this.db
      .prepare(`SELECT provider,model,baseUrl,apiKeyEnc,persona,temperature,enabled FROM user_llm WHERE userId=?`)
      .get(userId) as
      | { provider: string; model: string; baseUrl: string; apiKeyEnc: string | null; persona: string | null; temperature: number | null; enabled: number }
      | undefined;
    if (!row || !row.apiKeyEnc) return null;
    const apiKey = decryptApiKey(row.apiKeyEnc);
    if (!apiKey) return null;
    return {
      provider: row.provider,
      model: row.model,
      baseUrl: row.baseUrl,
      apiKey,
      persona: row.persona ?? "",
      temperature: row.temperature ?? 0.7,
      enabled: !!row.enabled,
    };
  }

  /** 保存（apiKeyEnc 传 null 表示保留旧密钥）；upsert */
  saveLlmConfig(
    userId: string,
    cfg: { provider: string; model: string; baseUrl: string; apiKeyEnc: string | null; persona: string; temperature: number; enabled: boolean }
  ) {
    this.db
      .prepare(
        `INSERT INTO user_llm (userId,provider,model,baseUrl,apiKeyEnc,persona,temperature,enabled,updatedAt)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(userId) DO UPDATE SET
           provider=excluded.provider, model=excluded.model, baseUrl=excluded.baseUrl,
           apiKeyEnc=COALESCE(excluded.apiKeyEnc, apiKeyEnc),
           persona=excluded.persona, temperature=excluded.temperature,
           enabled=excluded.enabled, updatedAt=excluded.updatedAt`
      )
      .run(userId, cfg.provider, cfg.model, cfg.baseUrl, cfg.apiKeyEnc, cfg.persona, cfg.temperature, cfg.enabled ? 1 : 0, Date.now());
  }

  /** 面板展示用：脱敏状态（不出明文密钥，只给尾号打码） */
  llmConfigStatus(userId: string): {
    provider: string;
    model: string;
    baseUrl: string;
    persona: string;
    temperature: number;
    enabled: boolean;
    hasKey: boolean;
    keyMask: string;
    updatedAt: number;
  } | null {
    const row = this.db
      .prepare(`SELECT provider,model,baseUrl,apiKeyEnc,persona,temperature,enabled,updatedAt FROM user_llm WHERE userId=?`)
      .get(userId) as
      | { provider: string; model: string; baseUrl: string; apiKeyEnc: string | null; persona: string | null; temperature: number | null; enabled: number; updatedAt: number }
      | undefined;
    if (!row) return null;
    const key = row.apiKeyEnc ? decryptApiKey(row.apiKeyEnc) : null;
    return {
      provider: row.provider,
      model: row.model,
      baseUrl: row.baseUrl,
      persona: row.persona ?? "",
      temperature: row.temperature ?? 0.7,
      enabled: !!row.enabled,
      hasKey: !!key,
      keyMask: key ? maskKey(key) : "",
      updatedAt: row.updatedAt,
    };
  }

  clearLlmConfig(userId: string) {
    this.db.prepare(`DELETE FROM user_llm WHERE userId=?`).run(userId);
  }

  /** 后台用户详情展示（不含密钥信息） */
  llmPublicInfo(userId: string): { provider: string; model: string; enabled: boolean; updatedAt: number } | null {
    const row = this.db
      .prepare(`SELECT provider,model,enabled,updatedAt FROM user_llm WHERE userId=?`)
      .get(userId) as { provider: string; model: string; enabled: number; updatedAt: number } | undefined;
    return row ? { provider: row.provider, model: row.model, enabled: !!row.enabled, updatedAt: row.updatedAt } : null;
  }

  countLlmUsers(): number {
    return (this.db.prepare(`SELECT COUNT(*) AS c FROM user_llm WHERE enabled=1 AND apiKeyEnc IS NOT NULL`).get() as { c: number }).c;
  }

  // ---------- 我的员工（agents：用户雇佣的个人 agent） ----------

  /** 某用户的员工列表 */
  listAgentsByOwner(ownerId: string): DbAgentRow[] {
    return this.db
      .prepare(
        `SELECT a.id, a.ownerId, u.name AS ownerName, a.name, a.role, a.personality, a.colorIdx, a.createdAt
         FROM agents a LEFT JOIN users u ON u.id = a.ownerId
         WHERE a.ownerId = ? ORDER BY a.createdAt`
      )
      .all(ownerId) as DbAgentRow[];
  }

  /** 全体个人 agent（启动播种进办公室，按雇佣先后占座） */
  listAllAgents(): DbAgentRow[] {
    return this.db
      .prepare(
        `SELECT a.id, a.ownerId, u.name AS ownerName, a.name, a.role, a.personality, a.colorIdx, a.createdAt
         FROM agents a LEFT JOIN users u ON u.id = a.ownerId
         ORDER BY a.createdAt`
      )
      .all() as DbAgentRow[];
  }

  getAgent(id: string): DbAgentRow | null {
    return (
      (this.db
        .prepare(
          `SELECT a.id, a.ownerId, u.name AS ownerName, a.name, a.role, a.personality, a.colorIdx, a.createdAt
           FROM agents a LEFT JOIN users u ON u.id = a.ownerId WHERE a.id = ?`
        )
        .get(id) as DbAgentRow | undefined) ?? null
    );
  }

  insertAgent(row: { id: string; ownerId: string; name: string; role: string; personality: string; colorIdx: number; createdAt: number }) {
    this.db
      .prepare(`INSERT INTO agents (id,ownerId,name,role,personality,colorIdx,createdAt) VALUES (?,?,?,?,?,?,?)`)
      .run(row.id, row.ownerId, row.name, row.role, row.personality, row.colorIdx, row.createdAt);
  }

  updateAgent(id: string, patch: { name?: string; role?: string; personality?: string; colorIdx?: number }) {
    const sets: string[] = [];
    const args: unknown[] = [];
    if (patch.name !== undefined) {
      sets.push("name=?");
      args.push(patch.name);
    }
    if (patch.role !== undefined) {
      sets.push("role=?");
      args.push(patch.role);
    }
    if (patch.personality !== undefined) {
      sets.push("personality=?");
      args.push(patch.personality);
    }
    if (patch.colorIdx !== undefined) {
      sets.push("colorIdx=?");
      args.push(patch.colorIdx);
    }
    if (!sets.length) return;
    args.push(id);
    this.db.prepare(`UPDATE agents SET ${sets.join(", ")} WHERE id=?`).run(...args);
  }

  deleteAgent(id: string) {
    this.db.prepare(`DELETE FROM agents WHERE id=?`).run(id);
  }

  countAgentsByOwner(ownerId: string): number {
    return (this.db.prepare(`SELECT COUNT(*) AS c FROM agents WHERE ownerId=?`).get(ownerId) as { c: number }).c;
  }

  countTodayNewUsers(): number {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    return (
      this.db.prepare(`SELECT COUNT(*) AS c FROM users WHERE createdAt>=?`).get(dayStart.getTime()) as { c: number }
    ).c;
  }

  // ---------- 聊天记录 ----------

  insertChatLog(kind: string, sender: string, fromId: string, text: string) {
    this.db.prepare(`INSERT INTO chat_log (ts,kind,sender,fromId,text) VALUES (?,?,?,?,?)`).run(
      Date.now(),
      kind,
      sender,
      fromId,
      text.slice(0, 200)
    );
    // 防膨胀：超 5000 条时删旧
    this.db
      .prepare(`DELETE FROM chat_log WHERE id <= (SELECT id FROM chat_log ORDER BY id DESC LIMIT 1 OFFSET 5000)`)
      .run();
  }

  /** 登录玩家最后位置（服务重启后上线仍从原地「复活」） */
  savePlayerPos(userId: string, x: number, y: number, z: number, rotY: number) {
    this.db
      .prepare(
        `INSERT INTO player_pos (userId,x,y,z,rotY,updatedAt) VALUES (?,?,?,?,?,?)
         ON CONFLICT(userId) DO UPDATE SET x=excluded.x,y=excluded.y,z=excluded.z,rotY=excluded.rotY,updatedAt=excluded.updatedAt`
      )
      .run(userId, x, y, z, rotY, Date.now());
  }

  // ---------- 土地（九州地块归属 / 申请 / 州长） ----------

  getPlot(plotId: string): { plotId: string; state: string; ownerId: string; ownerName: string; grantedAt: number } | null {
    return (this.db.prepare(`SELECT * FROM land_plots WHERE plotId = ?`).get(plotId) as never) ?? null;
  }

  setPlotOwner(plotId: string, state: string, ownerId: string, ownerName: string) {
    this.db
      .prepare(
        `INSERT INTO land_plots (plotId,state,ownerId,ownerName,grantedAt) VALUES (?,?,?,?,?)
         ON CONFLICT(plotId) DO UPDATE SET state=excluded.state,ownerId=excluded.ownerId,ownerName=excluded.ownerName,grantedAt=excluded.grantedAt`
      )
      .run(plotId, state, ownerId, ownerName, Date.now());
  }

  clearPlot(plotId: string) {
    this.db.prepare(`DELETE FROM land_plots WHERE plotId = ?`).run(plotId);
  }

  listPlots(): Array<{ plotId: string; state: string; ownerId: string; ownerName: string; grantedAt: number }> {
    return this.db.prepare(`SELECT * FROM land_plots ORDER BY grantedAt DESC`).all() as never;
  }

  createLandApp(id: string, plotId: string, state: string, applicantId: string, applicantName: string, reason: string) {
    this.db
      .prepare(
        `INSERT INTO land_apps (id,plotId,state,applicantId,applicantName,reason,status,createdAt) VALUES (?,?,?,?,?,?, 'pending', ?)`
      )
      .run(id, plotId, state, applicantId, applicantName, reason, Date.now());
  }

  getLandApp(id: string): { id: string; plotId: string; state: string; applicantId: string; applicantName: string; reason: string; status: string; reviewerId: string | null; reviewerName: string | null; reviewedAt: number | null; createdAt: number } | null {
    return (this.db.prepare(`SELECT * FROM land_apps WHERE id = ?`).get(id) as never) ?? null;
  }

  setLandAppStatus(id: string, status: "approved" | "rejected", reviewerId: string, reviewerName: string) {
    this.db.prepare(`UPDATE land_apps SET status=?, reviewerId=?, reviewerName=?, reviewedAt=? WHERE id=?`).run(status, reviewerId, reviewerName, Date.now(), id);
  }

  listLandApps(status?: "pending" | "approved" | "rejected"): Array<ReturnType<Db["getLandApp"]> & object> {
    if (status) return this.db.prepare(`SELECT * FROM land_apps WHERE status = ? ORDER BY createdAt DESC LIMIT 200`).all(status) as never;
    return this.db.prepare(`SELECT * FROM land_apps ORDER BY createdAt DESC LIMIT 200`).all() as never;
  }

  getGovernor(state: string): { state: string; userId: string; userName: string; appointedBy: string; appointedAt: number } | null {
    return (this.db.prepare(`SELECT * FROM governors WHERE state = ?`).get(state) as never) ?? null;
  }

  listGovernors(): Array<{ state: string; userId: string; userName: string; appointedBy: string; appointedAt: number }> {
    return this.db.prepare(`SELECT * FROM governors ORDER BY state`).all() as never;
  }

  setGovernor(state: string, userId: string, userName: string, appointedBy: string) {
    this.db
      .prepare(
        `INSERT INTO governors (state,userId,userName,appointedBy,appointedAt) VALUES (?,?,?,?,?)
         ON CONFLICT(state) DO UPDATE SET userId=excluded.userId,userName=excluded.userName,appointedBy=excluded.appointedBy,appointedAt=excluded.appointedAt`
      )
      .run(state, userId, userName, appointedBy, Date.now());
  }

  removeGovernor(state: string) {
    this.db.prepare(`DELETE FROM governors WHERE state = ?`).run(state);
  }

  getPlayerPos(userId: string): { x: number; y: number; z: number; rotY: number } | null {
    const r = this.db.prepare(`SELECT x,y,z,rotY FROM player_pos WHERE userId=?`).get(userId) as
      | { x: number; y: number; z: number; rotY: number }
      | undefined;
    return r ?? null;
  }

  listChatLogs(before: number | null, limit: number): ChatLogRow[] {
    const lim = Math.min(Math.max(limit, 1), 100);
    const sel = `SELECT id,ts,kind,sender AS "from",fromId,text FROM chat_log`;
    if (before) {
      return this.db
        .prepare(`SELECT * FROM (${sel} WHERE id<? ORDER BY id DESC LIMIT ?) ORDER BY id ASC`)
        .all(before, lim) as unknown as ChatLogRow[];
    }
    return this.db
      .prepare(`SELECT * FROM (${sel} ORDER BY id DESC LIMIT ?) ORDER BY id ASC`)
      .all(lim) as unknown as ChatLogRow[];
  }

  // ---------- 产权存证 ----------

  insertObjectProof(objectId: string, sig: string) {
    this.db
      .prepare(`INSERT OR REPLACE INTO object_proofs (objectId,sig,signedAt) VALUES (?,?,?)`)
      .run(objectId, sig, Date.now());
  }

  getObjectProof(objectId: string): { sig: string; signedAt: number } | null {
    return (this.db
      .prepare(`SELECT sig,signedAt FROM object_proofs WHERE objectId=?`)
      .get(objectId) as { sig: string; signedAt: number }) ?? null;
  }

  deleteObjectProof(objectId: string) {
    this.db.prepare(`DELETE FROM object_proofs WHERE objectId=?`).run(objectId);
  }

  insertAttestRoot(root: string, count: number) {
    this.db.prepare(`INSERT INTO attest_roots (root,count,createdAt) VALUES (?,?,?)`).run(root, count, Date.now());
  }

  latestAttestRoot(): { root: string; count: number; createdAt: number } | null {
    return (this.db
      .prepare(`SELECT root,count,createdAt FROM attest_roots ORDER BY id DESC LIMIT 1`)
      .get() as { root: string; count: number; createdAt: number }) ?? null;
  }

  listAttestRoots(): Array<{ root: string; count: number; createdAt: number }> {
    return this.db
      .prepare(`SELECT root,count,createdAt FROM attest_roots ORDER BY id DESC LIMIT 50`)
      .all() as unknown as Array<{ root: string; count: number; createdAt: number }>;
  }

  // ---------- 审计日志 ----------

  insertAudit(adminId: string, adminName: string, action: string, targetType: string, targetId: string, detail: string) {
    this.db
      .prepare(
        `INSERT INTO audit_log (ts,adminId,adminName,action,targetType,targetId,detail) VALUES (?,?,?,?,?,?,?)`
      )
      .run(Date.now(), adminId, adminName, action, targetType, targetId, detail.slice(0, 300));
  }

  listAudit(action: string | null, limit: number): AuditRow[] {
    const lim = Math.min(Math.max(limit, 1), 200);
    if (action) {
      return this.db
        .prepare(`SELECT * FROM audit_log WHERE action=? ORDER BY id DESC LIMIT ?`)
        .all(action, lim) as unknown as AuditRow[];
    }
    return this.db.prepare(`SELECT * FROM audit_log ORDER BY id DESC LIMIT ?`).all(lim) as unknown as AuditRow[];
  }

  countAudit(): number {
    return (this.db.prepare(`SELECT COUNT(*) AS c FROM audit_log`).get() as { c: number }).c;
  }

  // ---------- 事件流 ----------

  insertEvent(kind: string, actor: string, actorId: string, text: string, meta: string) {
    this.db
      .prepare(`INSERT INTO event_log (ts,kind,actor,actorId,text,meta) VALUES (?,?,?,?,?,?)`)
      .run(Date.now(), kind, actor, actorId, text.slice(0, 200), meta);
    // 防膨胀：保留最近 20000 条
    this.db
      .prepare(`DELETE FROM event_log WHERE id <= (SELECT id FROM event_log ORDER BY id DESC LIMIT 1 OFFSET 20000)`)
      .run();
  }

  listEventsSince(since: number, limit: number): EventRow[] {
    return this.db
      .prepare(`SELECT id,ts,kind,actor,actorId,text FROM event_log WHERE ts>=? ORDER BY id ASC LIMIT ?`)
      .all(since, Math.min(limit, 5000)) as unknown as EventRow[];
  }

  listEvents(limit: number): EventRow[] {
    return this.db
      .prepare(`SELECT id,ts,kind,actor,actorId,text FROM event_log ORDER BY id DESC LIMIT ?`)
      .all(Math.min(Math.max(limit, 1), 200)) as unknown as EventRow[];
  }

  countEvents(): number {
    return (this.db.prepare(`SELECT COUNT(*) AS c FROM event_log`).get() as { c: number }).c;
  }

  // ---------- 后台统计查询 ----------

  /** 按日聚合：注册 / 造物 / 聊天 */
  dailyCounts(days: number): Array<{ day: string; users: number; objects: number; chats: number }> {
    const since = startOfDay(Date.now() - (days - 1) * 86400_000);
    const buckets = new Map<string, { day: string; users: number; objects: number; chats: number }>();
    for (let i = 0; i < days; i++) {
      const d = new Date(since + i * 86400_000);
      buckets.set(dayKey(d), { day: dayKey(d), users: 0, objects: 0, chats: 0 });
    }
    const bump = (map: Array<{ ts: number }>, field: "users" | "objects" | "chats") => {
      for (const row of map) {
        const k = dayKey(new Date(row.ts));
        const b = buckets.get(k);
        if (b) b[field]++;
      }
    };
    bump(
      this.db.prepare(`SELECT createdAt AS ts FROM users WHERE createdAt>=?`).all(since) as unknown as Array<{ ts: number }>,
      "users"
    );
    bump(
      this.db.prepare(`SELECT createdAt AS ts FROM objects WHERE createdAt>=?`).all(since) as unknown as Array<{ ts: number }>,
      "objects"
    );
    bump(
      this.db.prepare(`SELECT ts FROM chat_log WHERE ts>=?`).all(since) as unknown as Array<{ ts: number }>,
      "chats"
    );
    return [...buckets.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
  }

  countObjectsByKind(): Array<{ label: string; value: number }> {
    return this.db
      .prepare(`SELECT kind AS label, COUNT(*) AS value FROM objects GROUP BY kind ORDER BY value DESC`)
      .all() as unknown as Array<{ label: string; value: number }>;
  }

  countObjectsByCreator(limit = 6): Array<{ label: string; value: number }> {
    return this.db
      .prepare(`SELECT creatorName AS label, COUNT(*) AS value FROM objects GROUP BY creatorName ORDER BY value DESC LIMIT ?`)
      .all(limit) as unknown as Array<{ label: string; value: number }>;
  }

  countChatsSince(ts: number): number {
    return (this.db.prepare(`SELECT COUNT(*) AS c FROM chat_log WHERE ts>=?`).get(ts) as { c: number }).c;
  }

  /** 多条件用户筛选 */
  listUsersFiltered(opts: { q: string; role: string; banned: string; limit: number; offset: number }): Array<{
    id: string;
    name: string;
    role: "user" | "admin";
    createdAt: number;
    lastLoginAt: number | null;
    banned: number;
  }> {
    const where: string[] = [];
    const args: unknown[] = [];
    if (opts.q) {
      where.push(`(name LIKE ? OR id LIKE ?)`);
      args.push(`%${opts.q}%`, `%${opts.q}%`);
    }
    if (opts.role === "admin" || opts.role === "user") {
      where.push(`role=?`);
      args.push(opts.role);
    }
    if (opts.banned === "1") where.push(`banned=1`);
    else if (opts.banned === "0") where.push(`banned=0`);
    const sql = `SELECT id,name,role,createdAt,lastLoginAt,banned FROM users
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY createdAt DESC LIMIT ? OFFSET ?`;
    args.push(Math.min(Math.max(opts.limit, 1), 200), Math.max(opts.offset, 0));
    return this.db.prepare(sql).all(...args) as unknown as Array<{
      id: string;
      name: string;
      role: "user" | "admin";
      createdAt: number;
      lastLoginAt: number | null;
      banned: number;
    }>;
  }

  countUsersFiltered(opts: { q: string; role: string; banned: string }): number {
    const where: string[] = [];
    const args: unknown[] = [];
    if (opts.q) {
      where.push(`(name LIKE ? OR id LIKE ?)`);
      args.push(`%${opts.q}%`, `%${opts.q}%`);
    }
    if (opts.role === "admin" || opts.role === "user") {
      where.push(`role=?`);
      args.push(opts.role);
    }
    if (opts.banned === "1") where.push(`banned=1`);
    else if (opts.banned === "0") where.push(`banned=0`);
    const row = this.db
      .prepare(`SELECT COUNT(*) AS c FROM users ${where.length ? `WHERE ${where.join(" AND ")}` : ""}`)
      .get(...args) as { c: number };
    return row.c;
  }

  /** 用户详情：其造物 / 聊天 / 登录记录 */
  userDetail(userId: string) {
    const ownerKey = `u:${userId}`;
    return {
      objects: this.db
        .prepare(`SELECT id,kind,variant,x,z,creatorName,createdAt FROM objects WHERE creatorId=? ORDER BY createdAt DESC LIMIT 50`)
        .all(ownerKey) as unknown as Array<{ id: string; kind: string; variant: string; x: number; z: number; creatorName: string; createdAt: number }>,
      chats: this.db
        .prepare(`SELECT id,ts,kind,sender AS "from",fromId,text FROM chat_log WHERE fromId=? ORDER BY id DESC LIMIT 30`)
        .all(userId) as unknown as ChatLogRow[],
    };
  }

  /** 聊天筛选 */
  listChatFiltered(opts: {
    q: string;
    kind: string;
    from: string;
    fromTs: number;
    toTs: number;
    limit: number;
  }): ChatLogRow[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (opts.q) {
      where.push(`text LIKE ?`);
      args.push(`%${opts.q}%`);
    }
    if (opts.kind) {
      where.push(`kind=?`);
      args.push(opts.kind);
    }
    if (opts.from) {
      where.push(`sender LIKE ?`);
      args.push(`%${opts.from}%`);
    }
    if (opts.fromTs) {
      where.push(`ts>=?`);
      args.push(opts.fromTs);
    }
    if (opts.toTs) {
      where.push(`ts<=?`);
      args.push(opts.toTs);
    }
    args.push(Math.min(Math.max(opts.limit, 1), 200));
    return this.db
      .prepare(
        `SELECT id,ts,kind,sender AS "from",fromId,text FROM chat_log
         ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`
      )
      .all(...args) as unknown as ChatLogRow[];
  }

  /** 全局搜索：造物 */
  searchObjects(q: string, limit = 8): Array<{ id: string; kind: string; variant: string; creatorName: string; createdAt: number }> {
    return this.db
      .prepare(
        `SELECT id,kind,variant,creatorName,createdAt FROM objects
         WHERE kind LIKE ? OR variant LIKE ? OR creatorName LIKE ? ORDER BY createdAt DESC LIMIT ?`
      )
      .all(`%${q}%`, `%${q}%`, `%${q}%`, limit) as unknown as Array<{
      id: string;
      kind: string;
      variant: string;
      creatorName: string;
      createdAt: number;
    }>;
  }

  /** 全局搜索：聊天 */
  searchChats(q: string, limit = 8): ChatLogRow[] {
    return this.db
      .prepare(`SELECT id,ts,kind,sender AS "from",fromId,text FROM chat_log WHERE text LIKE ? ORDER BY id DESC LIMIT ?`)
      .all(`%${q}%`, limit) as unknown as ChatLogRow[];
  }

  /** 数据库文件大小（字节） */
  dbSizeBytes(): number {
    try {
      const file = this.db.name;
      return fs.existsSync(file) ? fs.statSync(file).size : 0;
    } catch {
      return 0;
    }
  }

  /** 各表行数 */
  tableCounts(): Record<string, number> {
    const tables = ["users", "objects", "chat_log", "office_projects", "office_tasks", "office_dialogues", "attest_roots", "object_proofs", "audit_log", "event_log", "land_plots", "land_apps", "governors"];
    const out: Record<string, number> = {};
    for (const t of tables) {
      try {
        out[t] = (this.db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c;
      } catch {
        out[t] = 0;
      }
    }
    return out;
  }
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export interface DbUserRow {
  id: string;
  name: string;
  passHash: string;
  role: "user" | "admin";
  createdAt: number;
  lastLoginAt: number;
  banned: number;
}
