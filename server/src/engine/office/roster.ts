// Office 房间名册：老板 + PM + 5 员工（移植自 office3d，去除 socket 依赖）
import { AgentInfo, AgentRole, BOSS_SPOT, EMPLOYEE_DESKS, PM_SPOT, DeskSpot } from "@world3d/shared";

// 每个 agent 的运行时状态（含客户端执行所需的位置信息）
export interface AgentRuntime extends AgentInfo {
  homeDesk: DeskSpot;
  seated: boolean;
}

const AGENT_DEFS: Array<{
  id: string;
  name: string;
  role: AgentRole;
  color: string;
  personality: string;
}> = [
  { id: "boss", name: "老板", role: "boss", color: "#3d3a34", personality: "沉稳、说一不二，喜欢一句话讲清楚目标" },
  { id: "pm", name: "林晓 PM", role: "pm", color: "#c65f76", personality: "干练热情的项目经理，拆任务又快又准，喜欢用 emoji" },
  { id: "e1", name: "阿谦", role: "product", color: "#5b8def", personality: "话不多的产品策划，逻辑清晰，爱写文档" },
  { id: "e2", name: "小鹿", role: "design", color: "#9a6ee2", personality: "文艺的设计师，说话带画面感，追求「氛围感」" },
  { id: "e3", name: "大鹏", role: "frontend", color: "#3aa981", personality: "乐观的前端工程师，爱打比方，口头禅「稳了」" },
  { id: "e4", name: "老周", role: "backend", color: "#d08a2e", personality: "严谨的后端工程师，三句不离并发与稳定" },
  { id: "e5", name: "琪琪", role: "qa", color: "#cf5b5b", personality: "细心的测试运营，什么问题都逃不过她的眼睛" },
];

export class OfficeRoster {
  agents = new Map<string, AgentRuntime>();
  /** 活动状态变化回调（由 OfficeRoom 接线到房间广播） */
  onChange: (a: AgentInfo) => void = () => {};

  constructor() {
    const desks = [...EMPLOYEE_DESKS];
    for (const def of AGENT_DEFS) {
      let homeDesk: DeskSpot;
      if (def.role === "boss") homeDesk = BOSS_SPOT;
      else if (def.role === "pm") homeDesk = PM_SPOT;
      else homeDesk = desks.shift()!;
      this.agents.set(def.id, { ...def, activity: "idle", seated: true, homeDesk });
    }
  }

  get(id: string): AgentRuntime {
    const a = this.agents.get(id);
    if (!a) throw new Error(`unknown agent ${id}`);
    return a;
  }

  setActivity(id: string, activity: AgentInfo["activity"], extra?: Partial<AgentInfo>) {
    const a = this.get(id);
    a.activity = activity;
    Object.assign(a, extra);
    this.onChange(this.publicInfo(a));
  }

  publicInfo(a: AgentRuntime): AgentInfo {
    return {
      id: a.id,
      name: a.name,
      role: a.role,
      color: a.color,
      personality: a.personality,
      activity: a.activity,
      currentTask: a.currentTask,
      currentProjectId: a.currentProjectId,
    };
  }

  list(): AgentInfo[] {
    return [...this.agents.values()].map((a) => this.publicInfo(a));
  }

  /** 按角色找空闲员工；roles 可为空 */
  findFreeEmployee(preferRoles?: string[]): string | null {
    const roles = preferRoles ?? [];
    for (const role of roles) {
      for (const a of this.agents.values()) {
        if (a.role === role && a.activity === "idle") return a.id;
      }
    }
    for (const a of this.agents.values()) {
      if (a.role !== "boss" && a.role !== "pm" && a.activity === "idle") return a.id;
    }
    return null;
  }
}
