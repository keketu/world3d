import { Brain, PlannedTask } from "./brain.js";
import {
  detectTemplate,
  makeProjectName,
  PM_ACCEPT,
  PM_ASSIGN,
  EMPLOYEE_ACCEPT_BY_ROLE,
  PM_DISCUSS,
  EMPLOYEE_REPLY,
  PM_REPLY_OK,
  MEETING_OPEN,
  MEETING_SHARE,
  MEETING_CLOSE,
  REPORT,
  pick,
} from "./scenarios.js";

// 任务完成后可用于会议分享的一句话总结
const SHARE_TEMPLATES = [
  "我负责的「{task}」已经完成，产出在共享盘里，大家有意见随时提。",
  "「{task}」搞定了，关键点我都标注过，risk 不大。",
  "「{task}」收尾了，自测过一轮，稳的。",
  "「{task}」完成，等大家交叉 review。",
];

// 模拟剧本 Brain —— 与将来的 LlmBrain 实现同一接口
export class ScriptedBrain implements Brain {
  async planProject(ctx: { brief: string; projectName: string }): Promise<PlannedTask[]> {
    const tpl = detectTemplate(ctx.brief);
    return tpl.tasks.map((t) => ({ ...t }));
  }

  async discuss(ctx: {
    projectName: string;
    taskTitle: string;
    pmName: string;
    employeeName: string;
    employeeRole: string;
    employeePersonality: string;
  }): Promise<Array<{ speaker: "pm" | "employee"; text: string }>> {
    const accept =
      EMPLOYEE_ACCEPT_BY_ROLE[ctx.employeeRole]?.(ctx.taskTitle) ??
      `收到，「${ctx.taskTitle}」这就开始。`;
    return [
      { speaker: "pm", text: pick(PM_ASSIGN(ctx.employeeName, ctx.taskTitle)) },
      { speaker: "employee", text: accept },
      { speaker: "pm", text: pick(PM_DISCUSS(ctx.employeeName, ctx.taskTitle, ctx.projectName)) },
      { speaker: "employee", text: pick(EMPLOYEE_REPLY(ctx.taskTitle)) },
      { speaker: "pm", text: PM_REPLY_OK() },
    ];
  }

  async meeting(ctx: {
    projectName: string;
    taskSummaries: string[];
    attendees: Array<{ name: string; role: string; personality: string }>;
  }): Promise<Array<{ speakerIndex: number; text: string }>> {
    const lines: Array<{ speakerIndex: number; text: string }> = [];
    const pmName = ctx.attendees[0]?.name ?? "PM";
    lines.push({ speakerIndex: 0, text: pick(MEETING_OPEN(pmName, ctx.projectName)) });
    ctx.attendees.forEach((a, i) => {
      if (i === 0) return; // index 0 是 PM 自己
      const taskTitle = ctx.taskSummaries[i - 1] ?? "我的部分";
      const summary = pick(SHARE_TEMPLATES).replace("{task}", taskTitle);
      lines.push({ speakerIndex: i, text: pick(MEETING_SHARE(a.name, summary)) });
    });
    lines.push({ speakerIndex: 0, text: MEETING_CLOSE(pmName) });
    return lines;
  }

  async report(ctx: { projectName: string; taskSummaries: string[] }): Promise<string> {
    return REPORT(ctx.projectName, ctx.taskSummaries.length);
  }

  /** PM 对老板简报的回应（走到老板桌接任务时） */
  acceptProject(brief: string): string {
    return PM_ACCEPT("大家", brief);
  }

  shareLine(taskTitle: string): string {
    return pick(SHARE_TEMPLATES).replace("{task}", taskTitle);
  }
}
