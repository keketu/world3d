// 道具目录：世界里可放置的「物」（两端共享）
export const WATER_LEVEL = 9;

export interface PropVariantDef {
  variant: string;
  label: string;
  icon: string;
}

export interface PropKindDef {
  kind: string;
  label: string;
  /** 碰撞半径（0 = 可穿过，如花） */
  collideR: number;
  variants: PropVariantDef[];
  /** 标注图标 */
  icon: string;
}

export const PROP_KINDS: Record<string, PropKindDef> = {
  tree: {
    kind: "tree",
    label: "树",
    collideR: 0.55,
    icon: "🌳",
    variants: [
      { variant: "樱花", label: "樱花树", icon: "🌸" },
      { variant: "松", label: "松树", icon: "🌲" },
      { variant: "白桦", label: "白桦树", icon: "🌳" },
      { variant: "橡", label: "橡树", icon: "🌳" },
    ],
  },
  flower: {
    kind: "flower",
    label: "花丛",
    collideR: 0,
    icon: "🌼",
    variants: [
      { variant: "红", label: "红花丛", icon: "🌺" },
      { variant: "黄", label: "黄花丛", icon: "🌻" },
      { variant: "粉", label: "粉花丛", icon: "🌸" },
      { variant: "白", label: "白花丛", icon: "🌼" },
    ],
  },
  house: {
    kind: "house",
    label: "小屋",
    collideR: 3.6,
    icon: "🏠",
    variants: [
      { variant: "小木屋", label: "小木屋", icon: "🏠" },
      { variant: "石屋", label: "石屋", icon: "🏛️" },
    ],
  },
  fence: {
    kind: "fence",
    label: "围栏",
    collideR: 0,
    icon: "🪵",
    variants: [{ variant: "木", label: "木围栏", icon: "🪵" }],
  },
  path: {
    kind: "path",
    label: "小路",
    collideR: 0,
    icon: "🛤️",
    variants: [
      { variant: "石板路", label: "石板路", icon: "🪨" },
      { variant: "木板路", label: "木板路", icon: "🟫" },
    ],
  },
  pond: {
    kind: "pond",
    label: "池塘",
    collideR: 0,
    icon: "💧",
    variants: [{ variant: "池塘", label: "池塘", icon: "💧" }],
  },
  office: {
    kind: "office",
    label: "办公楼",
    collideR: 4.2,
    icon: "🏢",
    variants: [{ variant: "小世界科技", label: "小世界科技办公楼", icon: "🏢" }],
  },
  tower: {
    kind: "tower",
    label: "写字楼",
    collideR: 4.4,
    icon: "🏢",
    variants: [
      { variant: "蓝玻璃", label: "蓝玻璃写字楼", icon: "🏢" },
      { variant: "暖白", label: "暖白写字楼", icon: "🏢" },
      { variant: "陶土红", label: "陶土红写字楼", icon: "🏢" },
    ],
  },
  shop: {
    kind: "shop",
    label: "商铺",
    collideR: 3.2,
    icon: "🏬",
    variants: [
      { variant: "咖啡橙", label: "咖啡橙商铺", icon: "🏬" },
      { variant: "薄荷绿", label: "薄荷绿商铺", icon: "🏬" },
      { variant: "奶油黄", label: "奶油黄商铺", icon: "🏬" },
    ],
  },
};

/** 大型建筑 kind（享受宅基地整平 / 相机避让 / 落座逻辑） */
export const BUILDING_KINDS = new Set(["house", "office", "tower", "shop"]);

export function isBuildingKind(kind: string): boolean {
  return BUILDING_KINDS.has(kind);
}

/** 建筑外壳尺寸 clamp 表：[下限, 上限, 默认值]（两端共用：放置/落座/室内生成/门口计算） */
export const BUILDING_DIMS: Record<string, { w: [number, number, number]; d: [number, number, number]; f: [number, number, number] }> = {
  house: { w: [3, 11, 5], d: [3, 11, 5], f: [4, 12, 6] },
  tower: { w: [6, 10, 8], d: [6, 10, 8], f: [4, 12, 6] },
  shop: { w: [5, 8, 6], d: [5, 8, 6], f: [4, 12, 6] },
  office: { w: [8, 8, 8], d: [6, 6, 6], f: [2, 2, 2] },
};

/** 读取建筑的实际外壳尺寸（params 按 clamp 表收敛） */
export function buildingSize(kind: string, params?: Record<string, unknown>): { w: number; d: number; f: number } {
  const t = BUILDING_DIMS[kind] ?? BUILDING_DIMS.house;
  const cl = (v: unknown, r: [number, number, number]) => Math.min(r[1], Math.max(r[0], Number(v ?? r[2])));
  return { w: cl(params?.w, t.w), d: cl(params?.d, t.d), f: cl(params?.f, t.f) };
}

/** 建筑的旋转矩形碰撞半尺寸（hw=半宽 hd=半深，已含 scale）——比圆形近似更贴墙防穿模 */
export function buildingRect(kind: string, params?: Record<string, unknown>, scale = 1): { hw: number; hd: number } | null {
  if (!BUILDING_KINDS.has(kind)) return null;
  const s = buildingSize(kind, params);
  return { hw: (s.w / 2) * scale, hd: (s.d / 2) * scale };
}

/** 手搓 hotbar：首位「空手」= 点击行走模式，其后为可放道具 */
export const HOTBAR_PROPS: Array<{ kind: string; variant: string; label: string; icon: string }> = [
  { kind: "hand", variant: "", label: "空手行走", icon: "✋" },
  { kind: "tree", variant: "樱花", label: "樱花树", icon: "🌸" },
  { kind: "tower", variant: "蓝玻璃", label: "写字楼", icon: "🏢" },
  { kind: "flower", variant: "粉", label: "粉花丛", icon: "🌸" },
  { kind: "shop", variant: "咖啡橙", label: "商铺", icon: "🏬" },
  { kind: "flower", variant: "黄", label: "黄花丛", icon: "🌻" },
  { kind: "fence", variant: "木", label: "木围栏", icon: "🪵" },
  { kind: "path", variant: "石板路", label: "石板路", icon: "🪨" },
];

export function propLabel(kind: string, variant: string): string {
  return PROP_KINDS[kind]?.variants.find((v) => v.variant === variant)?.label ?? PROP_KINDS[kind]?.label ?? kind;
}

export function propIcon(kind: string): string {
  return PROP_KINDS[kind]?.icon ?? "📦";
}

/** 道具是否有碰撞（行走避让） */
export function isPropCollidable(kind: string): number {
  return PROP_KINDS[kind]?.collideR ?? 0;
}
