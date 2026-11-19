import BetterSqlite3 from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { AdminUserRow, DialogueLine, ProjectInfo, TaskInfo, TerrainMod, WorldObject } from "@world3d/shared";

export interface ChatLogRow {
  id: number;
  ts: number;
  kind: string;
  from: string;
  fromId: string;
  text: string;
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
