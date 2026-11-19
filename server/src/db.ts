import BetterSqlite3 from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { DialogueLine, ProjectInfo, TaskInfo, TerrainMod, WorldObject } from "@world3d/shared";

// SQLite 持久化：道具造物（含创建者） + 地形雕塑 + office 房间（项目/任务/对话）
export class Db {
  private db: BetterSqlite3.Database;

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
  }

  deleteObject(id: string) {
    this.db.prepare(`DELETE FROM objects WHERE id=?`).run(id);
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
}
