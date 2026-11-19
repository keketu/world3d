// 台词库：项目模板、讨论/会议/汇报/闲聊对白
// 全部是模板函数，注入项目名/任务名/人名后生成自然台词

export interface ProjectTemplate {
  match: RegExp;
  name: string;
  tasks: Array<{ title: string; roles: string[]; durationMs: number }>;
}

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    match: /官网|网页|网站|landing|首页/i,
    name: "官网焕新",
    tasks: [
      { title: "用户画像与需求梳理", roles: ["product"], durationMs: 14_000 },
      { title: "首页视觉稿设计", roles: ["design"], durationMs: 18_000 },
      { title: "页面前端还原", roles: ["frontend"], durationMs: 20_000 },
      { title: "接口与数据接入", roles: ["backend"], durationMs: 16_000 },
      { title: "多端兼容测试", roles: ["qa", "frontend"], durationMs: 12_000 },
    ],
  },
  {
    match: /app|应用|小程序|客户端|mobile/i,
    name: "移动端 App",
    tasks: [
      { title: "核心流程原型", roles: ["product"], durationMs: 14_000 },
      { title: "交互与 UI 设计", roles: ["design"], durationMs: 18_000 },
      { title: "客户端开发", roles: ["frontend"], durationMs: 20_000 },
      { title: "服务端接口开发", roles: ["backend"], durationMs: 18_000 },
      { title: "回归测试与上架", roles: ["qa"], durationMs: 12_000 },
    ],
  },
  {
    match: /海报|banner|视觉|品牌|logo/i,
    name: "品牌视觉项目",
    tasks: [
      { title: "品牌调性梳理", roles: ["product"], durationMs: 12_000 },
      { title: "主视觉设计", roles: ["design"], durationMs: 20_000 },
      { title: "多尺寸延展", roles: ["design"], durationMs: 14_000 },
      { title: "投放渠道测试", roles: ["qa", "product"], durationMs: 10_000 },
    ],
  },
  {
    match: /数据|报表|大屏|看板|bi/i,
    name: "数据可视化",
    tasks: [
      { title: "指标体系梳理", roles: ["product"], durationMs: 14_000 },
      { title: "图表方案设计", roles: ["design"], durationMs: 14_000 },
      { title: "数据管道搭建", roles: ["backend"], durationMs: 18_000 },
      { title: "大屏前端开发", roles: ["frontend"], durationMs: 18_000 },
      { title: "数据准确性校验", roles: ["qa"], durationMs: 12_000 },
    ],
  },
  {
    match: /活动|运营|推广|campaign/i,
    name: "运营活动",
    tasks: [
      { title: "活动方案策划", roles: ["product"], durationMs: 12_000 },
      { title: "活动页视觉", roles: ["design"], durationMs: 14_000 },
      { title: "活动页开发", roles: ["frontend"], durationMs: 16_000 },
      { title: "埋点与数据回收", roles: ["backend"], durationMs: 12_000 },
      { title: "上线巡检", roles: ["qa"], durationMs: 10_000 },
    ],
  },
];

export const DEFAULT_TEMPLATE: ProjectTemplate = {
  match: /.*/,
  name: "神秘新项目",
  tasks: [
    { title: "需求澄清与拆解", roles: ["product"], durationMs: 12_000 },
    { title: "方案设计", roles: ["design", "product"], durationMs: 16_000 },
    { title: "核心功能实现", roles: ["frontend", "backend"], durationMs: 20_000 },
    { title: "质量验收", roles: ["qa"], durationMs: 12_000 },
  ],
};

// ---------- 对白生成（带随机变化） ----------

export function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export const PM_ACCEPT = (name: string, brief: string) =>
  pick([
    `收到老板！「${brief}」这个项目我来牵头，先拆一下任务 📋`,
    `没问题！「${brief}」包在我身上，我马上拆任务分派下去 💪`,
    `好嘞，「${brief}」是吧～我先理一下思路，马上安排 ${name} 们动手 ✨`,
  ]);

export const PM_ASSIGN = (employeeName: string, taskTitle: string) => [
  `${employeeName}，忙不忙？有个「${taskTitle}」想交给你。`,
];

export const EMPLOYEE_ACCEPT = (taskTitle: string, personality: string) => {
  const byRole: Record<string, string[]> = {
    product: [
      `好，「${taskTitle}」我来。我下午会先出一版结构稿，下班前发群里。`,
      `收到。这个我熟，先梳理用户路径，再落文档。`,
    ],
    design: [
      `"${taskTitle}"呀…让我想想画面感 🎨 我会先找几个参考再动笔。`,
      `好呀，我脑子已经有草图了，给我一块屏幕的时间。`,
    ],
    frontend: [
      `稳了！「${taskTitle}」就像搭积木，块儿我都有。`,
      `收到收到，今天 keyboard 给你敲出花来。`,
    ],
    backend: [
      `「${taskTitle}」，我评估下并发和存储，接口设计我会留好余量。`,
      `可以。稳定第一，我先把数据结构定下来。`,
    ],
    qa: [
      `好，「${taskTitle}」我来把最后一道关，用例我先列起来。`,
      `收到～谁写的代码都别想在我的 bug 列表里睡觉 😌`,
    ],
  };
  void personality;
  return pick(byRole.design && Object.values(byRole).flat()) // fallback 简化
    ? pick(Object.values(byRole).flat())
    : `收到，「${taskTitle}」这就开始。`;
};

// 按角色给员工分配合适的应答（比上面通用的更贴切）
export const EMPLOYEE_ACCEPT_BY_ROLE: Record<string, (taskTitle: string) => string> = {
  product: (t) =>
    pick([
      `好，「${t}」我来。先梳理用户路径，下午出结构稿。`,
      `收到，这个我熟。我把它拆成三个用户故事来推进。`,
    ]),
  design: (t) =>
    pick([
      `“${t}”呀…我脑子已经有画面了 🎨 先找几组参考再动笔。`,
      `好呀，交给我。我会让版面自己呼吸起来。`,
    ]),
  frontend: (t) =>
    pick([
      `稳了！「${t}」就像搭积木，块儿我都备好了。`,
      `收到收到，今天键盘给你敲出花来 ⌨️`,
    ]),
  backend: (t) =>
    pick([
      `「${t}」可以。稳定第一，我先把数据结构定下来。`,
      `没问题，我会把并发余量留足，别到时候流量一来就翻车。`,
    ]),
  qa: (t) =>
    pick([
      `好，「${t}」我来把最后一道关，用例先列起来。`,
      `收到～谁写的代码都别想在我的 bug 列表里过夜 😌`,
    ]),
};

export const PM_DISCUSS = (employeeName: string, taskTitle: string, projectName: string) => [
  `简单说下，「${projectName}」里「${taskTitle}」这块最关键是别跑偏，我先对齐下预期。`,
  `${employeeName}，有没有什么卡点？需要谁配合随时喊我。`,
  `时间上先按计划走，中途有风险立刻同步，别憋着。`,
];

export const EMPLOYEE_REPLY = (taskTitle: string) => [
  `明白，我先把「${taskTitle}」的第一版弄出来给你看。`,
  `了解～我大概知道方向了，先动手，细节我们对稿子。`,
  `OK，卡点应该不大，我列个 TODO 一步一步来。`,
];

export const PM_REPLY_OK = () =>
  pick([
    `好，就这么干 💪`,
    `完美，等你第一版～`,
    `节奏可以，辛苦！`,
  ]);

export const MEETING_OPEN = (pmName: string, projectName: string) => [
  `${pmName}：人齐了～「${projectName}」进入收尾阶段，咱们快速过一遍各自的进展。`,
];

export const MEETING_SHARE = (name: string, summary: string) => [
  `${name}：${summary}`,
];

export const MEETING_CLOSE = (pmName: string) =>
  pick([
    `${pmName}：好，大家进展都很扎实！我整理纪要发群里，散会 🙌`,
    `${pmName}：风险都记下了，接下来保持这个节奏，散会～`,
  ]);

export const REPORT = (projectName: string, count: number) =>
  pick([
    `老板，「${projectName}」全部收工！${count} 项任务都验收过了，会上大家也过了一遍，可以放心上线 ✅`,
    `老板，汇报一下：「${projectName}」完成了～每个环节都稳稳落地，等您验收 🎉`,
  ]);

// 闲聊（环境行为）
export const AMBIENT_CHAT: Record<string, string[]> = {
  coffee: [
    "这咖啡真香…再来一杯我能卷到下班 ☕",
    "接杯咖啡，灵感 +1",
    "咖啡机今天状态不错嘛",
  ],
  chat: [
    "周末去哪儿玩？",
    "昨天那集看了吗！太好笑了哈哈哈",
    "工位又长草了，我的多肉真争气 🪴",
    "下午茶点什么呢…",
    "今天代码一次跑通，运气不错",
  ],
  reply: ["哈哈是吧！", "真的假的，回头给我看看", "羡慕了羡慕了", "有空一起呀～"],
};

// ---------- 玩家与 agent 面对面闲聊（P2.5 交互） ----------

// 空闲时被老板搭话的角色化问候
export const AGENT_GREET: Record<string, string[]> = {
  pm: ["老板找我？随时待命 🫡", "在的在的～是不是又有新想法了？"],
  product: ["老板好，正好有份结构稿想请您过目。", "老板，我在理用户路径，有什么指示？"],
  design: ["老板～我刚在找参考，您来得正好 🎨", "老板好呀，这周的氛围感我调好了"],
  frontend: ["稳了老板，页面热乎着呢，随时可以演示！", "老板好！键盘已经就位 ⌨️"],
  backend: ["老板，接口都稳着呢，有什么指示？", "在的。并发和存储我都留了余量，您放心。"],
  qa: ["老板好～用例刚列完，正想找您对齐呢 😌", "老板，谁写的代码都逃不过我的 bug 列表"],
};

// 工作中被搭话（不打断手头活）
export const AGENT_BUSY = (task: string) => [
  `正在赶「${task}」，有事您说，耳朵一直开着 👂`,
  `「${task}」在跑了～我先不停手，您说话我听着呢`,
];

// 老板说完话后 agent 的回应
export const AGENT_REPLY = [
  "收到收到，马上办 📝",
  "明白，老板！这事儿我记在本子第一行",
  "好嘞老板，交给我 👌",
  "OK，方向我懂了，稳妥推进",
];

/** 老板说的话 → agent 应答（按内容路由台词，让回话听得见老板说了什么） */
export function agentReplyFor(agent: { name: string; role: string; currentTask?: string }, text: string): string {
  const q = text.replace(/\s+/g, "").slice(0, 36);
  if (/^(你好|您好|hi|hello|嗨|哈喽|在吗|在不在|早|早上好|下午好|晚上好)/i.test(q)) {
    return pick(["老板好呀！我正空着，您吩咐 😊", "在的在的～老板今天气色不错！", "老板好！随时听候调遣 🫡"]);
  }
  if (/进度|怎么样|做得如何|做完了吗|好了吗|什么时候能|还要多久|快了吗/.test(q)) {
    const t = agent.currentTask ? `「${agent.currentTask}」` : "手头的活";
    return pick([`${t}正在推进，比计划还快一点 📈`, `${t}快收尾了，今天之内给您准信`, "进度都在轨道上，我盯着呢 😌"]);
  }
  if (/谢谢|辛苦|干得好|不错|厉害|加油|赞|表扬/.test(q)) {
    return pick(["嘿嘿，被老板夸了，下午茶都有着落了 😋", "应该的应该的，团队给力！", "谢谢老板！下个项目更漂亮 💪"]);
  }
  if (/累不累|休息|咖啡|喝茶|樱花|下班|出去玩|赏花|吃饭/.test(q)) {
    return pick(["忙完这阵就去阳台吹风～老板一起呀 🌸", "咖啡刚续上，谢谢老板关心 ☕", "岛上樱花开了，周六组个赏花局？"]);
  }
  if (/[?？]$|怎么|为什么|能不能|可以吗|要不要/.test(q)) {
    return pick([`「${q}」——好问题，我理 10 秒给您靠谱答案 🤔`, "这个问题我在行，简单说：能，方案我这就整理 📝"]);
  }
  if (/帮|去做|改一下|加个|写个|弄好|搞定|处理|安排|排期|上线/.test(q)) {
    return pick([`收到！「${q}」这就安排，完工我直接来找您 📋`, `「${q}」没问题，记我本子第一行 ✍️`]);
  }
  return pick([`「${q}」收到！我记下了，有动静第一时间跟您说`, `明白，「${q}」这事儿我盯着 👀`, "好嘞，您说的我记在心里，马上落实 ✅"]);
}

// agent 主动走近老板搭话
export const BOSS_APPROACH = [
  "老板，正好想找您对个进度 📋",
  "老板辛苦了～咖啡给您续了一杯 ☕",
  "老板，有个小想法，您有空听听？",
  "老板，今天岛上樱花全开了，忙完想请您赏花 🌸",
  "老板，上周的活儿都收尾了，正闲着呢～",
];

export function detectTemplate(brief: string): ProjectTemplate {
  for (const t of PROJECT_TEMPLATES) {
    if (t.match.test(brief)) return t;
  }
  return DEFAULT_TEMPLATE;
}

export function makeProjectName(brief: string): string {
  const t = detectTemplate(brief);
  return t === DEFAULT_TEMPLATE ? brief.slice(0, 12) || "新项目" : t.name;
}
