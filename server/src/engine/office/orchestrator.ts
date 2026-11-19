import { randomUUID } from "node:crypto";
import {
  AgentOrder,
  DialogueLine,
  BOSS_SPOT,
  COFFEE,
  EMPLOYEE_DESKS,
  MEETING,
  ProjectInfo,
  TaskInfo,
} from "@world3d/shared";
import { OfficeRoster, AgentRuntime } from "./roster.js";
import { Brain, PlannedTask } from "./brain.js";
import { ScriptedBrain } from "./scriptedBrain.js";
import { AGENT_GREET, AGENT_BUSY, BOSS_APPROACH, AMBIENT_CHAT, agentReplyFor, pick } from "./scenarios.js";

/** 编排器所需的持久化接口（由 world3d Db 实现 office 表） */
export interface OfficeDb {
  insertProject(p: ProjectInfo): void;
  updateProject(p: ProjectInfo): void;
  insertTask(t: TaskInfo): void;
  updateTask(t: TaskInfo): void;
  insertDialogue(l: DialogueLine): void;
  loadPausedProjects(): Array<{ project: ProjectInfo; tasks: TaskInfo[] }>;
}

const WALK_SPEED = 1.7; // m/s，与前端一致
const ARRIVED_TIMEOUT = 60_000;

interface QueuedProject {
  project: ProjectInfo;
  tasks: TaskInfo[];
  /** 服务重启后的恢复模式：跳过简报与规划，直接继续剩余任务 */
  resume?: boolean;
  /** 下单玩家配置了自带 LLM 时，项目全流程用 TA 的大脑跑 */
  brain?: Brain;
}

export class Orchestrator {
  private world: OfficeRoster;
  private brain: Brain;
  private pmBrain: ScriptedBrain;
  private db: OfficeDb;
  private io: null | { emit: (ev: string, payload: unknown) => void } = null;

  private queue: QueuedProject[] = [];
  private pmBusy = false;
  /** 房间内玩家位置提供者（index.ts 注入 presence 查询） */
  playerProvider: (() => Array<{ id: string; x: number; z: number }>) | null = null;
  /**
   * 按玩家取「自带 LLM 大脑」（index.ts 注入）：玩家登录账号且配置/启用了大模型时返回
   * { brain, playerName, modelLabel }，否则 null（走内置剧本）。游客恒为 null。
   */
  brainFor: ((playerId: string | null) => { brain: Brain; playerName: string; modelLabel?: string } | null) | null = null;
  /**
   * 按账号 id 取「自带 LLM 大脑」：个人 agent（我的员工）被别人搭话时，
   * 用 TA 雇主配置的大模型应答（brainFor 按的是玩家 id）。
   */
  brainForUser: ((userId: string) => { brain: Brain; playerName: string; modelLabel?: string } | null) | null = null;
  /** 老板与某 agent 的进行中对话（玩家说话优先回给 TA） */
  private partners = new Map<string, { agentId: string; until: number }>();
  private orderSeq = 0;
  private arrivedWaiters = new Map<string, () => void>();
  private ambientTimer: NodeJS.Timeout | null = null;

  constructor(world: OfficeRoster, db: OfficeDb) {
    this.world = world;
    this.db = db;
    this.brain = new ScriptedBrain();
    this.pmBrain = new ScriptedBrain();
  }

  attach(io: { emit: (ev: string, payload: unknown) => void }) {
    this.io = io;
    this.startAmbientLoop();
    this.resumePaused();
  }

  /** 服务重启后，恢复暂停的项目（跳过老板简报，直接继续剩余任务） */
  private resumePaused() {
    const paused = this.db.loadPausedProjects();
    for (const { project, tasks } of paused) {
      if (tasks.every((t) => t.status === "done")) {
        project.status = "done";
        project.finishedAt = project.finishedAt ?? Date.now();
        this.db.updateProject(project);
        continue;
      }
      project.status = "in_progress";
      this.db.updateProject(project);
      this.emit("project:updated", project);
      this.queue.push({ project, tasks, resume: true });
      this.emit("notify", { text: `🔄 恢复项目「${project.name}」（服务重启，继续未完成任务）` });
    }
    this.pumpQueue();
  }

  // ---------- 基础动作原语 ----------

  private emit(ev: string, payload: unknown) {
    this.io?.emit(ev, payload);
  }

  /** agent 对老板说的话同步进房间聊天流（index.ts 把 "chat" 事件映射回客户端 chat 频道） */
  private emitToChat(from: string, text: string) {
    this.emit("chat", { id: randomUUID(), kind: "ai", from, text, ts: Date.now() });
  }

  private issueOrder(order: AgentOrder): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.arrivedWaiters.delete(order.orderId);
        resolve();
      }, ARRIVED_TIMEOUT);
      this.arrivedWaiters.set(order.orderId, () => {
        clearTimeout(timer);
        resolve();
      });
      this.emit("agent:order", order);
    });
  }

  onArrived(agentId: string, orderId: string) {
    const w = this.arrivedWaiters.get(orderId);
    if (w) {
      this.arrivedWaiters.delete(orderId);
      w();
    }
  }

  private walkDist(from: { x: number; z: number }, to: { x: number; z: number }) {
    return Math.hypot(to.x - from.x, to.z - from.z);
  }

  private async walkTo(agent: AgentRuntime, to: { x: number; z: number }, faceTo?: { x: number; z: number }) {
    const orderId = `ord-${++this.orderSeq}-${agent.id}`;
    console.log(`[orch] walk ${agent.id} -> (${to.x},${to.z}) est...`);
    const est = (this.walkDist(this.lastPos.get(agent.id) ?? agent.homeDesk.seat, to) / WALK_SPEED) * 1000;
    this.lastPos.set(agent.id, to);
    this.world.setActivity(agent.id, "walking");
    const p = this.issueOrder({ orderId, type: "walk", agentId: agent.id, x: to.x, z: to.z, faceTo });
    // 超时兜底：预计走路时间 + 5s 缓冲
    setTimeout(() => this.onArrived(agent.id, orderId), Math.max(est + 5000, 4000));
    await p;
    console.log(`[orch] walk done ${agent.id}`);
  }

  private lastPos = new Map<string, { x: number; z: number }>();

  private async sitAt(agent: AgentRuntime, seat: { x: number; z: number; rotY: number }) {
    const orderId = `ord-${++this.orderSeq}-${agent.id}`;
    this.lastPos.set(agent.id, seat);
    const p = this.issueOrder({ orderId, type: "sitAt", agentId: agent.id, x: seat.x, z: seat.z, rotY: seat.rotY });
    setTimeout(() => this.onArrived(agent.id, orderId), 2500);
    await p;
    agent.seated = true;
  }

  private async standUp(agent: AgentRuntime, faceTo?: { x: number; z: number }) {
    if (!agent.seated) return;
    const orderId = `ord-${++this.orderSeq}-${agent.id}`;
    this.lastPos.set(agent.id, agent.homeDesk.seat);
    const p = this.issueOrder({ orderId, type: "standUp", agentId: agent.id, faceTo });
    setTimeout(() => this.onArrived(agent.id, orderId), 1200);
    await p;
    agent.seated = false;
  }

  private async face(agent: AgentRuntime, to: { x: number; z: number }) {
    const orderId = `ord-${++this.orderSeq}-${agent.id}`;
    this.issueOrder({ orderId, type: "face", agentId: agent.id, to });
    await new Promise((r) => setTimeout(r, 350));
  }

  /** 说出一句对白：气泡 + 历史落库，等 holdMs 让观众读完 */
  private async say(
    agentId: string,
    text: string,
    opts: { projectId?: string; toAgentId?: string; kind: DialogueLine["kind"]; holdMs?: number } = { kind: "discuss" }
  ) {
    const line: DialogueLine = {
      id: randomUUID(),
      ts: Date.now(),
      projectId: opts.projectId,
      agentId,
      toAgentId: opts.toAgentId,
      text,
      kind: opts.kind ?? "discuss",
      holdMs: opts.holdMs ?? Math.max(2200, Math.min(5200, text.length * 190)),
    };
    console.log(`[orch] say ${agentId}: ${text.slice(0, 24)} (hold ${line.holdMs})`);
    this.db.insertDialogue(line);
    this.emit("dialogue:line", line);
    this.world.setActivity(agentId, "talking");
    await new Promise((r) => setTimeout(r, line.holdMs));
  }

  /** 轻量说话：用于与老板的闲聊——working 的 agent 保持打字不打断，idle 的说完回归 idle */
  private async sayCasual(
    agentId: string,
    text: string,
    opts: { holdMs?: number } = {}
  ) {
    const line: DialogueLine = {
      id: randomUUID(),
      ts: Date.now(),
      agentId,
      text,
      kind: "discuss",
      holdMs: opts.holdMs ?? Math.max(2400, Math.min(4600, text.length * 180)),
    };
    this.db.insertDialogue(line);
    this.emit("dialogue:line", line);
    const a = this.world.get(agentId);
    const wasIdle = a.activity === "idle";
    if (wasIdle) this.world.setActivity(agentId, "talking");
    await new Promise((r) => setTimeout(r, line.holdMs));
    if (wasIdle) this.world.setActivity(agentId, "idle");
  }

  /** 老板走到某 agent 面前发起对话（E 键触发）——问候同时落进房间聊天流 */
  async talkTo(agentId: string, player: { id: string; x: number; z: number }) {
    const a = this.world.get(agentId);
    if (a.role === "boss") return;
    if (a.controlledBy) return; // 被附身操控中：身体归玩家管，AI 不抢
    this.partners.set(player.id, { agentId, until: Date.now() + 45_000 });
    await this.face(a, { x: player.x, z: player.z });
    const line =
      a.activity === "working"
        ? pick(AGENT_BUSY(a.currentTask ?? "手头的活"))
        : a.activity === "idle"
          ? pick(AGENT_GREET[a.role] ?? ["老板好，有什么吩咐？"])
          : "稍等哈老板，手头这一步一收尾就找您聊～";
    this.emitToChat(a.name, line);
    await this.sayCasual(a.id, line);
  }

  /** 老板回话：面朝说话人，按老板说的内容应答（个人 agent 用雇主的大模型，其余按说话玩家的） */
  async replyTo(agentId: string, text: string, speaker?: { id: string; x: number; z: number }, playerId?: string | null) {
    const a = this.world.get(agentId);
    if (a.controlledBy) return; // 附身中：话由操控的玩家自己说
    const player = speaker ?? this.playerProvider?.().find(() => true);
    if (player) await this.face(a, { x: player.x, z: player.z });
    const hook = a.ownerId
      ? this.brainForUser?.(a.ownerId) ?? null
      : playerId != null
        ? this.brainFor?.(playerId) ?? null
        : null;
    const line = hook
      ? await hook.brain.reply({ name: a.name, role: a.role, currentTask: a.currentTask }, text, hook.playerName)
      : agentReplyFor({ name: a.name, role: a.role, currentTask: a.currentTask }, text);
    this.emitToChat(a.name, line);
    await this.sayCasual(a.id, line);
  }

  /** 附身结束（或个人 agent 出生校准）：让 agent 自己走回工位坐好 */
  async returnHome(agentId: string) {
    const a = this.world.agents.get(agentId);
    if (!a || a.controlledBy) return;
    this.world.setActivity(agentId, "walking");
    await this.walkTo(a, a.homeDesk.seat, { x: a.homeDesk.desk.x, z: a.homeDesk.desk.z - 3 });
    await this.sitAt(a, a.homeDesk.seat);
    this.world.setActivity(agentId, "idle");
  }

  /** agent 主动走近老板搭话（环境行为） */
  private async approachPlayer(player: { id: string; x: number; z: number }) {
    const idle = [...this.world.agents.values()].filter(
      (a) => a.role !== "boss" && a.role !== "pm" && a.activity === "idle" && a.seated && !a.controlledBy
    );
    if (idle.length === 0) return;
    const a = pick(idle);
    const from = this.lastPos.get(a.id) ?? a.homeDesk.seat;
    const dx = player.x - from.x;
    const dz = player.z - from.z;
    const d = Math.hypot(dx, dz) || 1;
    const target = { x: player.x - (dx / d) * 1.4, z: player.z - (dz / d) * 1.4 };
    this.partners.set(player.id, { agentId: a.id, until: Date.now() + 45_000 });
    await this.standUp(a);
    this.world.setActivity(a.id, "walking");
    await this.walkTo(a, target, { x: player.x, z: player.z });
    await this.sayCasual(a.id, pick(BOSS_APPROACH));
    await this.walkTo(a, a.homeDesk.seat, { x: a.homeDesk.desk.x, z: a.homeDesk.desk.z - 3 });
    await this.sitAt(a, a.homeDesk.seat);
    this.world.setActivity(a.id, "idle");
  }

  // ---------- 老板下单 ----------

  async assignProject(brief: string, playerId?: string | null) {
    const name = brief.slice(0, 16) || "新项目";
    const project: ProjectInfo = {
      id: randomUUID(),
      name,
      brief,
      status: "queued",
      createdAt: Date.now(),
    };
    this.db.insertProject(project);
    this.emit("project:updated", project);
    // 下单玩家配置了自带 LLM → 项目全流程（接单/拆任务/讨论/会议/汇报）用 TA 的大脑
    const hook = playerId != null ? this.brainFor?.(playerId) : null;
    this.queue.push({ project, tasks: [], brain: hook?.brain });
    this.emit("notify", {
      text: hook
        ? `📋 新项目进入队列：「${name}」（🧠 由你的${hook.modelLabel ? ` ${hook.modelLabel}` : "大模型"} 驱动）`
        : `📋 新项目进入队列：「${name}」`,
    });
    this.pumpQueue();
  }

  /** 老板说话：指定/身边的 agent 优先接话（排队串行，免得话叠话），否则 PM 出场 */
  private sayChain: Promise<void> = Promise.resolve();
  async bossSpeak(playerId: string, text: string, agentId?: string, speaker?: { id: string; x: number; z: number }) {
    const job = () => this.doBossSpeak(playerId, text, agentId, speaker);
    const p = this.sayChain.then(job, job);
    this.sayChain = p.catch(() => {});
    await p;
  }

  private async doBossSpeak(playerId: string, text: string, agentId?: string, speaker?: { id: string; x: number; z: number }) {
    const partner = this.partners.get(playerId);
    const target = agentId ?? (partner && partner.until > Date.now() ? partner.agentId : null);
    if (target && this.world.agents.has(target) && target !== "boss" && !this.world.agents.get(target)!.controlledBy) {
      this.partners.set(playerId, { agentId: target, until: Date.now() + 45_000 });
      await this.replyTo(target, text, speaker, playerId);
      return;
    }
    await this.bossChatter(text);
  }

  /** 老板闲聊：PM 过来回应一句 */
  async bossChatter(text: string) {
    await this.say("boss", text, { kind: "boss", holdMs: 3000 });
    if (!this.pmBusy) {
      const pm = this.world.get("pm");
      await this.standUp(pm);
      await this.walkTo(pm, BOSS_SPOT.standPoint, BOSS_SPOT.seat);
      await this.say("pm", pick(["老板有什么指示？我随时待命 🫡", "在的在的，您说～", "收到收到，我记下来了 📝"]), {
        kind: "discuss",
      });
      await this.walkTo(pm, pm.homeDesk.seat, { x: pm.homeDesk.desk.x, z: pm.homeDesk.desk.z - 3 });
      await this.sitAt(pm, pm.homeDesk.seat);
      this.world.setActivity("pm", "idle");
    }
  }

  private async pumpQueue() {
    if (this.pmBusy) return;
    const next = this.queue.shift();
    if (!next) return;
    this.pmBusy = true;
    this.runProject(next).finally(() => {
      this.pmBusy = false;
      this.pumpQueue();
    });
  }

  // ---------- 项目生命周期 ----------

  private async runProject(q: QueuedProject) {
    const { project } = q;
    const pm = this.world.get("pm");
    const boss = this.world.get("boss");
    // 项目大脑：下单玩家自带 LLM 时整段流程用它，否则内置剧本
    const brain = q.brain ?? this.brain;
    let tasks: TaskInfo[];
    let planned: PlannedTask[] | null = null;

    if (q.resume) {
      // 恢复模式：跳过简报与规划，直接继续未完成的任务
      tasks = q.tasks;
      project.status = "in_progress";
      this.db.updateProject(project);
      this.emit("project:updated", project);
      await this.standUp(pm);
      await this.say("pm", `大家稍等，服务刚重启过～我确认了下进度，继续推进「${project.name}」剩下的任务 💪`, {
        projectId: project.id,
        kind: "discuss",
      });
    } else {
      project.status = "planning";
      this.db.updateProject(project);
      this.emit("project:updated", project);

      // 1. PM 走到老板桌前接需求
      await this.standUp(pm);
      this.emit("notify", { text: `🚶 ${pm.name} 前往老板办公室接需求` });
      await this.walkTo(pm, BOSS_SPOT.standPoint, BOSS_SPOT.seat);
      await this.say("boss", `「${project.brief}」这个项目就交给你了，需要人手直接调配。`, {
        projectId: project.id,
        toAgentId: "pm",
        kind: "boss",
      });
      await this.say("pm", await brain.acceptProject(project.brief), {
        projectId: project.id,
        toAgentId: "boss",
        kind: "discuss",
      });

      // 2. 拆解任务
      planned = await brain.planProject({ brief: project.brief, projectName: project.name });
      tasks = planned.map((t, i) => ({
        id: randomUUID(),
        projectId: project.id,
        title: t.title,
        status: "pending",
        order: i,
      }));
      tasks.forEach((t) => this.db.insertTask(t));
      q.tasks = tasks;
      project.status = "in_progress";
      this.db.updateProject(project);
      this.emit("project:updated", project);
    }

    // 3. 逐个派活（员工干活是异步并行的）
    const workers: Array<{ agent: AgentRuntime; task: TaskInfo; done: Promise<void> }> = [];
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      if (task.status === "done") continue;
      // 恢复模式下，把中断的任务重置为待派
      if (task.status !== "pending") {
        task.status = "pending";
        this.db.updateTask(task);
      }
      const plannedTask = planned?.[i];
      const employeeId = this.world.findFreeEmployee(plannedTask?.roles);
      if (!employeeId) {
        // 没有空闲员工：等一会儿再试
        await new Promise((r) => setTimeout(r, 6000));
        const retry = this.world.findFreeEmployee(plannedTask?.roles);
        if (!retry) {
          task.status = "done";
          this.db.updateTask(task);
          this.emit("task:updated", task);
          continue;
        }
        task.assigneeId = retry;
      } else {
        task.assigneeId = employeeId;
      }
      const employee = this.world.get(task.assigneeId!);
      this.db.updateTask(task);
      this.emit("task:updated", task);

      // PM 走到员工工位旁
      this.emit("notify", { text: `🚶 ${pm.name} 找 ${employee.name} 面谈「${task.title}」` });
      await this.walkTo(pm, employee.homeDesk.standPoint, employee.homeDesk.seat);

      // 员工起身面朝 PM
      await this.standUp(employee, employee.homeDesk.standPoint);
      await this.face(employee, this.lastPos.get(pm.id) ?? BOSS_SPOT.standPoint);

      // 面对面对话
      const lines = await brain.discuss({
        projectName: project.name,
        taskTitle: task.title,
        pmName: pm.name,
        employeeName: employee.name,
        employeeRole: employee.role,
        employeePersonality: employee.personality,
      });
      for (const l of lines) {
        const speaker = l.speaker === "pm" ? pm : employee;
        const listener = l.speaker === "pm" ? employee.id : pm.id;
        await this.say(speaker.id, l.text, { projectId: project.id, toAgentId: listener, kind: "discuss" });
      }

      // 员工回座开工（异步）
      task.status = "in_progress";
      this.db.updateTask(task);
      this.emit("task:updated", task);
      const done = this.startWorking(employee, task);
      workers.push({ agent: employee, task, done });
    }

    // 4. PM 回自己工位等大家干完
    await this.walkTo(pm, pm.homeDesk.standPoint, { x: pm.homeDesk.desk.x, z: pm.homeDesk.desk.z - 3 });
    await this.sitAt(pm, pm.homeDesk.seat);
    this.world.setActivity(pm.id, "working", { currentTask: `跟进「${project.name}」`, currentProjectId: project.id });
    await Promise.all(
      workers.map(async (w) => {
        await w.done;
        // 员工完工后回到工位坐好（startWorking 里已把活动置回 idle，但位置可能在会议中被动过）
      })
    );
    this.world.setActivity(pm.id, "idle", { currentTask: undefined });

    // 5. 全员会议
    project.status = "meeting";
    this.db.updateProject(project);
    this.emit("project:updated", project);
    await this.runMeeting(pm, project, tasks, brain);

    // 6. PM 向老板汇报
    project.status = "reporting";
    this.db.updateProject(project);
    this.emit("project:updated", project);
    await this.standUp(pm);
    this.emit("notify", { text: `🚶 ${pm.name} 向老板汇报「${project.name}」` });
    await this.walkTo(pm, BOSS_SPOT.standPoint, BOSS_SPOT.seat);
    const report = await brain.report({
      projectName: project.name,
      taskSummaries: tasks.map((t) => t.title),
    });
    await this.say("pm", report, { projectId: project.id, toAgentId: boss.id, kind: "report" });
    await this.say("boss", pick(["干得漂亮 👍", "很好，这是今年的标杆项目。", "不错，辛苦大家了 🎉"]), {
      projectId: project.id,
      kind: "boss",
    });
    await this.walkTo(pm, pm.homeDesk.seat, { x: pm.homeDesk.desk.x, z: pm.homeDesk.desk.z - 3 });
    await this.sitAt(pm, pm.homeDesk.seat);
    this.world.setActivity(pm.id, "idle");

    // 7. 完成
    project.status = "done";
    project.finishedAt = Date.now();
    this.db.updateProject(project);
    this.emit("project:updated", project);
    this.emit("notify", { text: `🎉 项目「${project.name}」交付完成！` });
  }

  private startWorking(employee: AgentRuntime, task: TaskInfo): Promise<void> {
    // 返回在任务完成时 resolve 的 Promise（供项目流程等待）
    const duration = 14_000 + Math.floor(Math.random() * 10_000);
    const startedAt = Date.now();
    const endsAt = startedAt + duration;
    (task as TaskInfo & { startedAt?: number; endsAt?: number }).startedAt = startedAt;
    (task as TaskInfo & { startedAt?: number; endsAt?: number }).endsAt = endsAt;
    this.emit("task:updated", task);
    this.world.setActivity(employee.id, "working", {
      currentTask: task.title,
      currentProjectId: task.projectId,
    });
    return new Promise<void>((resolve) => {
      const step = setInterval(() => {
        this.emit("task:progress", { taskId: task.id, startedAt, endsAt });
      }, 1000);
      setTimeout(() => {
        clearInterval(step);
        task.status = "done";
        this.db.updateTask(task);
        this.emit("task:updated", task);
        this.world.setActivity(employee.id, "idle", { currentTask: undefined, currentProjectId: undefined });
        resolve();
      }, duration);
    });
  }

  private async runMeeting(pm: AgentRuntime, project: ProjectInfo, tasks: TaskInfo[], brain: Brain = this.brain) {
    this.emit("meeting:started", { projectId: project.id });
    this.emit("notify", { text: `📢 ${pm.name} 召集全员会议` });
    const pmAgent = pm;
    // 被附身操控的员工不强制拉进会议室（身体归玩家管）
    const employees = [...this.world.agents.values()].filter((a) => a.role !== "boss" && a.role !== "pm" && !a.controlledBy);

    await this.standUp(pmAgent);
    // 会议对白准备
    const attendees = [
      { name: "PM", role: "pm", personality: "" },
      ...employees.map((e) => ({ name: e.name, role: e.role, personality: e.personality })),
    ];
    const lines = await brain.meeting({
      projectName: project.name,
      taskSummaries: tasks.map((t) => t.title),
      attendees,
    });

    // 全员走向会议室（并行）
    await Promise.all(
      employees.map(async (e, i) => {
        const seat = MEETING.seats[(i + 1) % MEETING.seats.length];
        await this.standUp(e);
        await this.walkTo(e, { x: seat.x, z: seat.z });
        await this.sitAt(e, seat);
        this.world.setActivity(e.id, "meeting");
      })
    );
    const pmSeat = MEETING.seats[0];
    await this.walkTo(pmAgent, { x: pmSeat.x, z: pmSeat.z });
    await this.sitAt(pmAgent, pmSeat);
    this.world.setActivity(pmAgent.id, "meeting", { currentProjectId: project.id });

    // 轮流发言
    for (const l of lines) {
      const speaker = l.speakerIndex === 0 ? pmAgent : employees[l.speakerIndex - 1];
      if (!speaker) continue;
      await this.say(speaker.id, l.text, { projectId: project.id, kind: "meeting" });
    }

    // 散会：各自回工位（并行）
    await Promise.all(
      employees.map(async (e) => {
        await this.walkTo(e, e.homeDesk.seat, { x: e.homeDesk.desk.x, z: e.homeDesk.desk.z - 3 });
        await this.sitAt(e, e.homeDesk.seat);
        this.world.setActivity(e.id, "idle");
      })
    );
    this.emit("meeting:ended", { projectId: project.id });
    await this.walkTo(pmAgent, pmAgent.homeDesk.seat, { x: pmAgent.homeDesk.desk.x, z: pmAgent.homeDesk.desk.z - 3 });
    await this.sitAt(pmAgent, pmAgent.homeDesk.seat);
    this.world.setActivity(pmAgent.id, "idle");
  }

  // ---------- 环境行为：让办公室有生命感 ----------

  private ambientRunning = false;

  startAmbientLoop() {
    if (this.ambientTimer) return;
    this.ambientTimer = setInterval(() => void this.ambientTick(), 9000);
  }

  private async ambientTick() {
    if (this.ambientRunning || this.pmBusy) return;
    const idleAgents = [...this.world.agents.values()].filter(
      (a) => a.role !== "boss" && a.role !== "pm" && a.activity === "idle" && a.seated && !a.controlledBy
    );
    if (idleAgents.length === 0) return;
    if (Math.random() > 0.45) return;
    this.ambientRunning = true;
    try {
      // 优先：房间里有玩家 → 空闲 agent 主动走近搭话（不打断项目流）
      const players = this.playerProvider?.() ?? [];
      if (players.length > 0 && Math.random() < 0.55) {
        console.log("[orch] approach player attempt");
        await this.approachPlayer(pick(players));
        return;
      }
      const a = pick(idleAgents);
      if (Math.random() < 0.55) {
        // 去咖啡角
        await this.standUp(a);
        this.world.setActivity(a.id, "coffee");
        await this.walkTo(a, COFFEE.standPoint, { x: COFFEE.machine.x, z: COFFEE.machine.z });
        await this.say(a.id, pick(AMBIENT_CHAT.coffee), { kind: "ambient" });
        await this.walkTo(a, a.homeDesk.seat, { x: a.homeDesk.desk.x, z: a.homeDesk.desk.z - 3 });
        await this.sitAt(a, a.homeDesk.seat);
        this.world.setActivity(a.id, "idle");
      } else {
        // 找另一个空闲员工闲聊
        const others = idleAgents.filter((o) => o.id !== a.id && o.activity === "idle");
        if (others.length === 0) return;
        const b = pick(others);
        const mid = {
          x: (a.homeDesk.standPoint.x + b.homeDesk.standPoint.x) / 2,
          z: (a.homeDesk.standPoint.z + b.homeDesk.standPoint.z) / 2 + 1.6,
        };
        await this.standUp(a);
        await this.standUp(b);
        this.world.setActivity(a.id, "talking");
        this.world.setActivity(b.id, "talking");
        await Promise.all([
          this.walkTo(a, { x: mid.x - 0.5, z: mid.z }, { x: mid.x + 0.5, z: mid.z }),
          this.walkTo(b, { x: mid.x + 0.5, z: mid.z }, { x: mid.x - 0.5, z: mid.z }),
        ]);
        await this.say(a.id, pick(AMBIENT_CHAT.chat), { kind: "ambient", holdMs: 2400 });
        await this.say(b.id, pick(AMBIENT_CHAT.reply), { kind: "ambient", holdMs: 2400 });
        await Promise.all([
          this.walkTo(a, a.homeDesk.seat, { x: a.homeDesk.desk.x, z: a.homeDesk.desk.z - 3 }),
          this.walkTo(b, b.homeDesk.seat, { x: b.homeDesk.desk.x, z: b.homeDesk.desk.z - 3 }),
        ]);
        await Promise.all([this.sitAt(a, a.homeDesk.seat), this.sitAt(b, b.homeDesk.seat)]);
        this.world.setActivity(a.id, "idle");
        this.world.setActivity(b.id, "idle");
      }
    } catch {
      // 环境行为失败无所谓
    } finally {
      this.ambientRunning = false;
    }
  }
}
