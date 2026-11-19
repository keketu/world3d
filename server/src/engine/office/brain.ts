// Agent 大脑接口 —— 模拟剧本与将来的 LLM 实现共用
// 切换实现只需在 orchestrator 里换一个 Brain 实例，编排逻辑零改动

export interface PlannedTask {
  title: string;
  roles: string[]; // 期望承担的员工角色，按优先级
  durationMs: number;
}

export interface Brain {
  /** 把老板的一句话需求拆成子任务 */
  planProject(ctx: { brief: string; projectName: string }): Promise<PlannedTask[]>;

  /** PM 与员工面对面讨论任务时的一段对白（交替发言） */
  discuss(ctx: {
    projectName: string;
    taskTitle: string;
    pmName: string;
    employeeName: string;
    employeeRole: string;
    employeePersonality: string;
  }): Promise<Array<{ speaker: "pm" | "employee"; text: string }>>;

  /** 会议对白：全员轮流发言 */
  meeting(ctx: {
    projectName: string;
    taskSummaries: string[];
    attendees: Array<{ name: string; role: string; personality: string }>;
  }): Promise<Array<{ speakerIndex: number; text: string }>>;

  /** PM 给老板的最终汇报 */
  report(ctx: { projectName: string; taskSummaries: string[] }): Promise<string>;
}
