// LLM 大脑：把办公室 agent 的对话/拆任务/讨论/会议/汇报交给用户配置的大模型驱动
// 任何一步失败（超时/报错/解析不出 JSON）都回落到内置剧本，游戏永不卡壳
import { Brain, PlannedTask } from "./brain.js";
import { ScriptedBrain } from "./scriptedBrain.js";
import { chatComplete, LlmCallConfig, LlmError } from "../../llm.js";

const KNOWN_ROLES = new Set(["product", "design", "frontend", "backend", "qa"]);

/** 从模型输出里抠出 JSON 数组（模型有时会裹 ```json 或加前后白话） */
function extractJsonArray<T>(raw: string): T[] | null {
  const s = raw.indexOf("[");
  const e = raw.lastIndexOf("]");
  if (s < 0 || e <= s) return null;
  try {
    const parsed = JSON.parse(raw.slice(s, e + 1)) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : null;
  } catch {
    return null;
  }
}

export class LlmBrain implements Brain {
  private cfg: LlmCallConfig;
  private fallback: ScriptedBrain;
  /** 当前并发调用数：超并发直接回落剧本，保护小服务器 */
  private inflight = 0;
  private maxInflight: number;

  constructor(cfg: LlmCallConfig, fallback?: ScriptedBrain, maxInflight = 4) {
    this.cfg = cfg;
    this.fallback = fallback ?? new ScriptedBrain();
    this.maxInflight = maxInflight;
  }

  get model() {
    return this.cfg.model;
  }

  /** 统一出口：并发保护 + 错误日志 + 抛错由调用方回落 */
  private async call(system: string, user: string, maxTokens: number, timeoutMs = 20_000): Promise<string> {
    if (this.inflight >= this.maxInflight) throw new LlmError(0, "并发超限，本次走剧本");
    this.inflight++;
    try {
      return await chatComplete(
        this.cfg,
        [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        { maxTokens, timeoutMs }
      );
    } finally {
      this.inflight--;
    }
  }

  private personaLine(): string {
    const p = this.cfg.persona?.trim();
    return p ? `\n额外人设要求：${p}` : "";
  }

  // ---------- 玩家与 agent 面对面对话（最高频路径，限时更短） ----------

  async reply(
    agent: { name: string; role: string; currentTask?: string },
    text: string,
    playerName: string
  ): Promise<string> {
    try {
      const ROLE_ZH: Record<string, string> = {
        pm: "项目经理", product: "产品经理", design: "设计师",
        frontend: "前端工程师", backend: "后端工程师", qa: "测试工程师", boss: "老板",
      };
      const out = await this.call(
        `你在一个温馨的 3D 小岛世界里，扮演办公室里的${ROLE_ZH[agent.role] ?? agent.role}「${agent.name}」。` +
          `玩家「${playerName}」是你的老板。用口语中文回复，不超过 40 个字，可以带一个 emoji，` +
          `不要换行、不要列表、不要解释你是 AI。${this.personaLine()}`,
        `${agent.currentTask ? `（你正在忙「${agent.currentTask}」，没干完）\n` : ""}老板对你说：「${text}」`,
        120,
        12_000
      );
      const line = out.replace(/\s+/g, " ").trim();
      if (!line || line.length > 120) throw new LlmError(0, "回复过长/为空");
      return line;
    } catch (e) {
      console.warn(`[llmBrain] reply 回落剧本: ${(e as Error).message}`);
      return this.fallback.reply(agent, text, playerName);
    }
  }

  // ---------- 项目流程 ----------

  async acceptProject(brief: string): Promise<string> {
    try {
      const out = await this.call(
        `你是 3D 小岛办公室的项目经理，老板刚把一个项目交给你。用一句不超过 36 字的话回应领下任务，` +
          `口语、有干劲、可以带 emoji，不要换行。${this.personaLine()}`,
        `老板说：「${brief}」这个项目交给你了。`,
        100
      );
      const line = out.replace(/\s+/g, " ").trim();
      if (!line || line.length > 100) throw new LlmError(0, "回应异常");
      return line;
    } catch (e) {
      console.warn(`[llmBrain] acceptProject 回落剧本: ${(e as Error).message}`);
      return this.fallback.acceptProject(brief);
    }
  }

  async planProject(ctx: { brief: string; projectName: string }): Promise<PlannedTask[]> {
    try {
      const out = await this.call(
        `你是项目经理。把老板的需求拆解成 3-5 个子任务。` +
          `严格只输出 JSON 数组，格式：[{"title":"任务名(不超过14字)","roles":["product|design|frontend|backend|qa 里的 1-2 个"]}]，` +
          `不要输出任何其他文字或代码块标记。`,
        `项目名「${ctx.projectName}」，需求：「${ctx.brief}」`,
        400
      );
      const arr = extractJsonArray<{ title?: string; roles?: string[] }>(out);
      if (!arr) throw new LlmError(0, "拆任务 JSON 解析失败");
      const tasks: PlannedTask[] = arr
        .filter((t) => typeof t?.title === "string" && t.title.trim())
        .slice(0, 6)
        .map((t) => ({
          title: String(t.title).trim().slice(0, 24),
          roles: (Array.isArray(t.roles) ? t.roles : []).filter((r) => KNOWN_ROLES.has(r)).slice(0, 2),
          durationMs: 12_000 + Math.floor(Math.random() * 8_000),
        }));
      if (tasks.length < 2) throw new LlmError(0, "拆出的任务太少");
      return tasks;
    } catch (e) {
      console.warn(`[llmBrain] planProject 回落剧本: ${(e as Error).message}`);
      return this.fallback.planProject(ctx);
    }
  }

  async discuss(ctx: {
    projectName: string;
    taskTitle: string;
    pmName: string;
    employeeName: string;
    employeeRole: string;
    employeePersonality: string;
  }): Promise<Array<{ speaker: "pm" | "employee"; text: string }>> {
    try {
      const ROLE_ZH: Record<string, string> = {
        product: "产品经理", design: "设计师", frontend: "前端工程师", backend: "后端工程师", qa: "测试工程师",
      };
      const out = await this.call(
        `写一段 PM 与员工面对面派任务的对话，4-6 句，双方交替。角色：PM「${ctx.pmName}」与` +
          `${ROLE_ZH[ctx.employeeRole] ?? ctx.employeeRole}「${ctx.employeeName}」（性格：${ctx.employeePersonality || "随和"}）。` +
          `严格只输出 JSON 数组：[{"speaker":"pm","text":"..."},{"speaker":"employee","text":"..."}]，` +
          `每句不超过 36 字、口语、贴合角色，不要代码块标记。${this.personaLine()}`,
        `项目「${ctx.projectName}」，要派的任务：「${ctx.taskTitle}」`,
        500
      );
      const arr = extractJsonArray<{ speaker?: string; text?: string }>(out);
      if (!arr) throw new LlmError(0, "讨论 JSON 解析失败");
      const lines = arr
        .filter((l) => (l?.speaker === "pm" || l?.speaker === "employee") && typeof l.text === "string" && l.text.trim())
        .slice(0, 8)
        .map((l) => ({ speaker: l.speaker as "pm" | "employee", text: String(l.text).replace(/\s+/g, " ").trim().slice(0, 90) }));
      if (lines.length < 2) throw new LlmError(0, "讨论轮数太少");
      return lines;
    } catch (e) {
      console.warn(`[llmBrain] discuss 回落剧本: ${(e as Error).message}`);
      return this.fallback.discuss(ctx);
    }
  }

  async meeting(ctx: {
    projectName: string;
    taskSummaries: string[];
    attendees: Array<{ name: string; role: string; personality: string }>;
  }): Promise<Array<{ speakerIndex: number; text: string }>> {
    try {
      const roster = ctx.attendees.map((a, i) => `${i}. ${a.name}（${a.role}）`).join("、");
      const taskList = ctx.taskSummaries.map((t, i) => `${i + 1}. ${t}`).join("\n");
      const out = await this.call(
        `写一场项目收尾会议的发言。参会人（编号即 speakerIndex）：${roster}。` +
          `PM(index 0) 开场，每个成员按编号至少发言一次（说说自己负责任务的进展），PM 最后收尾。` +
          `严格只输出 JSON 数组：[{"speakerIndex":0,"text":"..."}]，每句不超过 40 字、口语，不要代码块标记。${this.personaLine()}`,
        `项目「${ctx.projectName}」的任务：\n${taskList}`,
        600
      );
      const arr = extractJsonArray<{ speakerIndex?: number; text?: string }>(out);
      if (!arr) throw new LlmError(0, "会议 JSON 解析失败");
      const lines = arr
        .filter(
          (l) => typeof l?.speakerIndex === "number" && l.speakerIndex >= 0 && l.speakerIndex < ctx.attendees.length &&
            typeof l.text === "string" && l.text.trim()
        )
        .slice(0, ctx.attendees.length + 3)
        .map((l) => ({
          speakerIndex: Math.floor(l.speakerIndex as number),
          text: String(l.text).replace(/\s+/g, " ").trim().slice(0, 90),
        }));
      if (lines.length < 2) throw new LlmError(0, "会议发言太少");
      return lines;
    } catch (e) {
      console.warn(`[llmBrain] meeting 回落剧本: ${(e as Error).message}`);
      return this.fallback.meeting(ctx);
    }
  }

  async report(ctx: { projectName: string; taskSummaries: string[] }): Promise<string> {
    try {
      const out = await this.call(
        `你是项目经理，向老板做项目交付汇报。一句话，不超过 60 字，先说结果再说亮点，可以带 emoji，不要换行。${this.personaLine()}`,
        `项目「${ctx.projectName}」全部完成，任务清单：${ctx.taskSummaries.join("、")}`,
        160
      );
      const line = out.replace(/\s+/g, " ").trim();
      if (!line || line.length > 140) throw new LlmError(0, "汇报异常");
      return line;
    } catch (e) {
      console.warn(`[llmBrain] report 回落剧本: ${(e as Error).message}`);
      return this.fallback.report(ctx);
    }
  }
}
