// 像素头像：按 id 确定性生成 8×8 像素小人脸（对称镜像），导出 dataURL 给名牌/面板用
// 无美术资源也能给每个玩家一个稳定、可区分的 Q 版头像
const CACHE = new Map<string, string>();

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rngOf(seed: string) {
  let a = hashStr(seed);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 生成 8×8 像素脸的 dataURL（48×48 放大，像素风） */
export function pixelAvatarDataURL(id: string): string {
  const cached = CACHE.get(id);
  if (cached) return cached;
  const rng = rngOf("face:" + id);
  const N = 8;
  const scale = 6;
  const canvas = document.createElement("canvas");
  canvas.width = N * scale;
  canvas.height = N * scale;
  const g = canvas.getContext("2d")!;

  // 背景色块（柔色系，按 hash 选）
  const bgColors = ["#f6e7c8", "#e8f0f6", "#f6e3e0", "#eaf3e2", "#efe9f8"];
  g.fillStyle = bgColors[Math.floor(rng() * bgColors.length)];
  g.fillRect(0, 0, canvas.width, canvas.height);

  // 皮肤色 / 发色 / 眼睛
  const skins = ["#f2c9a0", "#e8b48a", "#d9a06e", "#f4d3b0"];
  const skins2 = ["#e5b98e", "#d8a67b", "#c68e5e", "#e3c096"];
  const hairs = ["#3a2e28", "#5a3d2b", "#1f1a16", "#7a4a2b", "#8a8f96", "#b56a4e"];
  const skin = skins[Math.floor(rng() * skins.length)];
  const skinDark = skins2[Math.floor(rng() * skins2.length)];
  const hair = hairs[Math.floor(rng() * hairs.length)];
  const eye = "#26201a";
  const clothColors = ["#5b8def", "#d97a8c", "#7bb98a", "#e8a05a", "#9a8fd8", "#d86a6a"];
  const cloth = clothColors[Math.floor(rng() * clothColors.length)];

  const px = (x: number, y: number, color: string) => {
    g.fillStyle = color;
    g.fillRect(x * scale, y * scale, scale, scale);
  };

  // 头发：顶部两行 + 两鬓（部分人无刘海）
  const fringe = rng() > 0.3;
  for (let x = 1; x < N - 1; x++) {
    px(x, 0, hair);
    px(x, 1, hair);
    if (fringe) px(x, 2, hair);
  }
  px(0, 1, hair);
  px(N - 1, 1, hair);
  px(0, 2, hair);
  px(N - 1, 2, hair);
  // 发型变体：中分或全包
  if (rng() > 0.5) {
    px(3, 2, hair);
  } else {
    px(N - 4, 2, hair);
  }

  // 脸：4 行（左右对称只画一半再镜像太费事，直接逐像素画）
  for (let y = 2; y < 6; y++) {
    for (let x = 1; x < N - 1; x++) {
      if (fringe && y === 2 && rng() > 0.55) continue; // 刘海缺口
      px(x, y, rng() > 0.12 ? skin : skinDark); // 少量暗像素当腮红/阴影
    }
  }

  // 眼睛（y=3）：左右各一颗深像素，偶尔闭眼（横线）
  if (rng() > 0.15) {
    px(2, 3, eye);
    px(N - 3, 3, eye);
  } else {
    px(2, 4, eye);
    px(N - 3, 4, eye);
  }
  // 嘴（y=5）：小点或横线
  if (rng() > 0.4) {
    px(4, 5, "#a85454");
  } else {
    px(3, 5, "#a85454");
    px(N - 4, 5, "#a85454");
  }

  // 衣服（y=6..7）
  for (let y = 6; y < N; y++) {
    for (let x = 0; x < N; x++) {
      px(x, y, rng() > 0.15 ? cloth : skinDark);
    }
  }
  // 领口
  px(3, 6, "#f7f4ea");
  px(N - 4, 6, "#f7f4ea");

  const url = canvas.toDataURL("image/png");
  CACHE.set(id, url);
  return url;
}
