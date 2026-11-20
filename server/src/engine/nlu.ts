// 中文自然语言 → 建造计划（模板 NLU，预留 LLM 替换接口）

export type BuildAction = "tree" | "flower" | "house" | "tower" | "shop" | "path" | "fence" | "pond" | "clear" | "help";

export interface BuildPlan {
  action: BuildAction;
  /** 树/花/建筑的种类 */
  variant?: string;
  count?: number;
  w?: number;
  d?: number;
  /** 楼层数（tower） */
  floors?: number;
  len?: number;
  radius?: number;
  layout?: "line" | "circle" | "scatter";
  /** 解析失败时的说明 */
  helpText?: string;
}

const CN_NUM: Record<string, number> = {
  一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

function parseCount(s: string): number {
  const m = s.match(/(\d+)/);
  if (m) return Math.min(30, Math.max(1, parseInt(m[1])));
  for (const [k, v] of Object.entries(CN_NUM)) {
    if (s.includes(k)) return v;
  }
  return 1;
}

/** 中文建造指令解析（P1 模板版；LLM 版实现同一接口即可替换） */
export function parseBrief(brief: string): BuildPlan {
  const s = brief.trim();

  // 帮助
  if (/帮助|怎么玩|能做什么|指令|help/i.test(s)) {
    return { action: "help", helpText: buildHelpText() };
  }

  // 种树
  if (/种|栽|植/.test(s) && /树/.test(s)) {
    const variant = ["樱花", "松", "白桦", "橡"].find((k) => s.includes(k)) ?? "树";
    let count = parseCount(s);
    const layout: BuildPlan["layout"] = /一排|排/.test(s) ? "line" : /一圈|环绕/.test(s) ? "circle" : "scatter";
    // 「一圈/一排」没写数量时给默认值，不然圈不起来
    if (!/\d/.test(s)) {
      if (layout === "circle") count = 8;
      if (layout === "line") count = 5;
    }
    return { action: "tree", variant, count, layout };
  }

  // 种花
  if (/种|栽|植/.test(s) && /花/.test(s)) {
    const colorKey = ["红", "黄", "粉", "白"].find((k) => s.includes(k)) ?? "";
    const count = parseCount(s);
    return {
      action: "flower",
      variant: colorKey || "mixed",
      count: /花坛/.test(s) ? Math.max(count, 9) : count,
      layout: /花坛/.test(s) ? "circle" : "scatter",
    };
  }

  // 盖写字楼（在盖房之前匹配，避免「楼」落进小屋分支）
  if (/盖|建|修|造/.test(s) && /楼|大厦|写字楼|高层/.test(s)) {
    const sizeM = s.match(/(\d+)\s*[x×*]\s*(\d+)/);
    const fM = s.match(/(\d+)\s*层/);
    const variant = /陶土|红/.test(s) ? "陶土红" : /暖白|白/.test(s) ? "暖白" : "蓝玻璃";
    return {
      action: "tower",
      variant,
      w: sizeM ? Math.min(10, Math.max(6, parseInt(sizeM[1]))) : 8,
      d: sizeM ? Math.min(10, Math.max(6, parseInt(sizeM[2]))) : 8,
      floors: fM ? Math.min(12, Math.max(4, parseInt(fM[1]))) : 6,
    };
  }

  // 开商铺
  if (/开|盖|建|修|造/.test(s) && /店|商铺|门面|便利店/.test(s)) {
    const sizeM = s.match(/(\d+)\s*[x×*]\s*(\d+)/);
    const variant = /薄荷|绿/.test(s) ? "薄荷绿" : /奶油|黄/.test(s) ? "奶油黄" : "咖啡橙";
    return {
      action: "shop",
      variant,
      w: sizeM ? Math.min(8, Math.max(5, parseInt(sizeM[1]))) : 6,
      d: sizeM ? Math.min(8, Math.max(5, parseInt(sizeM[2]))) : 6,
    };
  }

  // 盖房
  if (/盖|建|修|造/.test(s) && /房|屋|小屋/.test(s)) {
    const sizeM = s.match(/(\d+)\s*[x×*]\s*(\d+)/);
    const variant = /石/.test(s) ? "石屋" : "小木屋";
    return {
      action: "house",
      variant,
      w: sizeM ? Math.min(11, Math.max(3, parseInt(sizeM[1]))) : 5,
      d: sizeM ? Math.min(11, Math.max(3, parseInt(sizeM[2]))) : 5,
    };
  }

  // 铺路
  if (/铺|修/.test(s) && /路/.test(s)) {
    const len = /(\d+)/.test(s) ? Math.min(40, parseInt(s.match(/(\d+)/)![0])) : 8;
    return { action: "path", variant: /木/.test(s) ? "木板路" : "石板路", len };
  }

  // 围栏
  if (/围栏|栅栏|篱笆/.test(s)) {
    return { action: "fence", len: /(\d+)/.test(s) ? Math.min(30, parseInt(s.match(/(\d+)/)![0])) : 7 };
  }

  // 池塘
  if (/池塘|挖.{0,6}(湖|坑)|湖/.test(s)) {
    const r = /(\d+)/.test(s) ? Math.min(9, Math.max(2, parseInt(s.match(/(\d+)/)![0]))) : 4;
    return { action: "pond", radius: r };
  }

  // 清空
  if (/清空|清除|铲平|拆/.test(s)) {
    const r = /(\d+)/.test(s) ? Math.min(12, Math.max(2, parseInt(s.match(/(\d+)/)![0]))) : 5;
    return { action: "clear", radius: r };
  }

  return { action: "help", helpText: buildHelpText() };
}

export function buildHelpText(): string {
  return [
    "我是 AI 施工队 🏗️ 试试对我说：",
    "· 「在我附近种3棵樱花树」「种一圈松树」",
    "· 「种一个粉色花坛」「种5朵红花」",
    "· 「盖一座小木屋」「盖一个7x6石屋」",
    "· 「盖一栋蓝玻璃写字楼」「造一栋10层大楼」",
    "· 「开一家咖啡橙商铺」「开个薄荷绿便利店」",
    "· 「铺一条12格石板路」「修一圈围栏」",
    "· 「挖一个半径4的池塘」「清空这里附近5格」",
  ].join("\n");
}
