// AI 建造调度：parse → generate → 分批放置（弹出动画）→ object 登记（溯源）→ 汇报
import { randomUUID } from "node:crypto";
import { AiDonePayload, AiProgressPayload, ChatMessage, WorldObject, plotIdAt } from "@world3d/shared";
import { World, WorldObjectRow } from "./world.js";
import { Db } from "../db.js";
import { parseBrief, BuildPlan } from "./nlu.js";
import { generate } from "./generators.js";

export interface Emitter {
  emit(event: string, payload: unknown): void;
}

export class Builder {
  private world: World;
  private db: Db;
  private io: Emitter | null = null;
  private busy = new Set<string>();

  constructor(world: World, db: Db) {
    this.world = world;
    this.db = db;
  }

  attach(io: Emitter) {
    this.io = io;
  }

  private chat(msg: ChatMessage) {
    this.io?.emit("chat", msg);
  }

  private aiChat(text: string) {
    this.chat({
      id: randomUUID(),
      kind: "ai",
      from: "AI 施工队",
      text,
      ts: Date.now(),
    });
  }

  /** 收到一句话。返回 true = 已按建造指令处理（或给出帮助） */
  /** 土地建造权限：九州地块须为本人土地（管理员/州长豁免），公共区放行 */
  private canBuildBy(by: string, x: number, z: number): { ok: boolean; reason?: string } {
    const plotId = plotIdAt(x, z);
    if (!plotId) return { ok: true }; // 公共区（广场/公园/道路/绿带）
    const plot = this.db.getPlot(plotId);
    const userId = by.startsWith("u:") ? by.slice(2) : null;
    const user = userId ? this.db.findUserById(userId) : null;
    if (user && !user.banned && user.role === "admin") return { ok: true };
    const gov = this.db.getGovernor(plotId.split("#")[0]);
    if (gov?.userId === userId) return { ok: true };
    if (!plot) return { ok: false, reason: `${plotId} 还没批给你——先在「🗺 土地」面板申请` };
    if (plot.ownerId === by) return { ok: true };
    return { ok: false, reason: `${plotId} 已被 ${plot.ownerName} 认领` };
  }

  async tryBuild(
    brief: string,
    by: string,
    byName: string,
    pos: { x: number; z: number },
    rotY: number
  ): Promise<boolean> {
    const plan: BuildPlan = parseBrief(brief);

    if (plan.action === "help") {
      this.aiChat(plan.helpText ?? "试试对我说「种3棵樱花树」「盖一座小木屋」～");
      return true;
    }
    if (this.busy.has(by)) {
      this.aiChat(`${byName} 的上一个工程还在施工中，稍等一下下 🚧`);
      return true;
    }

    // 土地建造权限：九州地块须为本人土地（管理员/州长豁免），公共区放行
    const centerCheck = this.canBuildBy(by, pos.x, pos.z);
    if (!centerCheck.ok) {
      this.aiChat(`${byName}，${centerCheck.reason}`);
      return true;
    }

    const gen = generate(this.world, plan, pos.x, pos.z, rotY);
    if (!gen || (gen.ops.length === 0 && !(gen.removeIds && gen.removeIds.length > 0))) {
      this.aiChat(`${byName}，这里放不下哦（可能太挤了或者在水边），换个位置试试？`);
      return true;
    }

    this.busy.add(by);
    const opId = randomUUID();
    this.aiChat(`收到！${byName} 的订单开工：${gen.summary} 🚧`);
    // （土地权限过滤在放置阶段执行，全部落点不被允许时会在结束时提示）

    const objectIds: string[] = [];

    // 清空指令：广播移除
    if (gen.removeIds && gen.removeIds.length > 0) {
      for (const id of gen.removeIds) {
        this.world.removeObject(id);
        this.db.deleteObject(id);
        this.io?.emit("world:remove", { id, by });
      }
    }

    // 分批放置（道具逐个弹出）
    const total = gen.ops.length;
    const BATCH = 5; // 每批 5 个道具
    const INTERVAL = 90;
    let applied = 0;
    let skipped = 0;

    await new Promise<void>((resolve) => {
      let i = 0;
      const timer = setInterval(() => {
        const batch = gen.ops.slice(i, i + BATCH);
        for (const op of batch) {
          if (!this.canBuildBy(by, op.x, op.z).ok) {
            skipped++;
            continue;
          }
          const row = this.world.addObject(
            {
              kind: op.kind,
              variant: op.variant,
              x: op.x,
              z: op.z,
              rotY: op.rotY,
              scale: op.scale ?? 1,
              creatorId: by,
              creatorName: byName,
              createdAt: Date.now(),
              params: op.params ?? {},
            },
            op.params
          );
          objectIds.push(row.id);
          this.db.insertObject(row);
          applied++;
          this.io?.emit("world:place", { object: this.publicObject(row) });
        }
        i += BATCH;
        const prog: AiProgressPayload = { opId, done: Math.min(applied, total), total, brief };
        this.io?.emit("ai:progress", prog);
        if (i >= total) {
          clearInterval(timer);
          resolve();
        }
      }, INTERVAL);
    });
    if (applied === 0 && skipped > 0) {
      this.aiChat(`${byName}，这次的落点全在别人的土地或未获批地块上，订单取消了 🗺️`);
    }

    // 地形雕塑（池塘）
    if (gen.sculpture) {
      const mod = this.world.addPondMod(gen.sculpture.x, gen.sculpture.z, gen.sculpture.r, gen.sculpture.depth, by);
      this.db.insertMod(mod);
      this.io?.emit("world:sculpt", { mod });
    }

    const done: AiDonePayload = { opId, ok: true, summary: gen.summary, objectIds };
    this.io?.emit("ai:done", done);
    this.aiChat(`${gen.summary} 盖好啦！已登记到 ${byName} 名下 ✍️`);
    this.busy.delete(by);
    return true;
  }

  private publicObject(row: WorldObjectRow): WorldObject {
    return {
      id: row.id,
      kind: row.kind,
      variant: row.variant,
      x: row.x,
      z: row.z,
      rotY: row.rotY,
      scale: row.scale,
      creatorId: row.creatorId,
      creatorName: row.creatorName,
      createdAt: row.createdAt,
      params: row.params,
    };
  }
}
