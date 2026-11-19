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
};

/** 手搓 hotbar 可放道具 */
export const HOTBAR_PROPS: Array<{ kind: string; variant: string; label: string; icon: string }> = [
  { kind: "tree", variant: "樱花", label: "樱花树", icon: "🌸" },
  { kind: "tree", variant: "松", label: "松树", icon: "🌲" },
  { kind: "flower", variant: "粉", label: "粉花丛", icon: "🌸" },
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
