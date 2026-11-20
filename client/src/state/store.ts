import { create } from "zustand";
import { AgentInfo, AuthUser, ChatMessage, DialogueLine, PlayerInfo, ProjectInfo, TaskInfo, WorldMeta, WorldObject } from "@world3d/shared";

export type QualityTier = "low" | "mid" | "high";
export type ViewMode = "third" | "first";

/** 操作方式：键盘 WASD 移动 / 鼠标点击行走（二选一互斥） */
export type ControlMode = "keyboard" | "mouse";

/** 玩家设置（持久化到 localStorage） */
export interface Settings {
  /** 鼠标转视角灵敏度（1 = 默认） */
  mouseSensitivity: number;
  /** 自由鼠标转向：鼠标横向滑动即转视角（不需按住拖动） */
  freeLook: boolean;
  /** 边缘锁定：鼠标滑到屏幕左右边缘时持续转向 */
  edgeLock: boolean;
  /** 操作方式：WASD 移动 与 点击行走 互斥，只能选一种 */
  controlMode: ControlMode;
  /** 键盘移动速度倍率（仅键盘模式生效） */
  keyboardSpeed: number;
}

export const DEFAULT_SETTINGS: Settings = {
  mouseSensitivity: 1,
  freeLook: true,
  edgeLock: true,
  controlMode: "keyboard",
  keyboardSpeed: 1,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem("w3d_settings");
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings> & { keyboardMove?: boolean };
    // 旧版迁移：原来的 keyboardMove 开关映射为新的二选一 controlMode
    if (parsed.controlMode !== "keyboard" && parsed.controlMode !== "mouse" && typeof parsed.keyboardMove === "boolean") {
      parsed.controlMode = parsed.keyboardMove ? "keyboard" : "mouse";
    }
    delete parsed.keyboardMove;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem("w3d_settings", JSON.stringify(s));
  } catch {
    /* 忽略存储失败 */
  }
}

export interface Toast {
  id: number;
  text: string;
}

interface WorldState {
  connected: boolean;
  joined: boolean;
  meta: WorldMeta | null;
  selfId: string;
  selfName: string;
  /** 登录账号（游客为 null） */
  auth: { user: AuthUser | null; token: string | null };
  /** 玩家设置 */
  settings: Settings;
  players: PlayerInfo[];
  chat: ChatMessage[];
  objects: WorldObject[];
  toasts: Toast[];
  showOwnerLabels: boolean;
  tier: QualityTier;
  hotbarIndex: number;
  aiBusy: boolean;
  viewMode: ViewMode;

  // ---------- office 房间 ----------
  inRoom: boolean;
  roomId: string | null;
  roomPrompt: "enter" | "leave" | null;
  agents: AgentInfo[];
  projects: ProjectInfo[];
  tasks: TaskInfo[];
  progress: Record<string, { startedAt: number; endsAt: number }>;
  roomDialogues: DialogueLine[];
  roomPanelOpen: boolean;
  nearAgent: { id: string; name: string } | null;
  lastTalkAgent: { id: string; until: number } | null;
  /** 附近可附身的自己员工 */
  nearOwnAgent: { id: string; name: string } | null;
  /** 正在附身操控的员工 */
  possessAgent: { id: string; name: string } | null;

  setConnected(v: boolean): void;
  setJoined(name: string): void;
  setAuth(user: AuthUser | null, token: string | null): void;
  logout(): void;
  setSettings(patch: Partial<Settings>): void;
  setMeta(m: WorldMeta): void;
  setPlayers(v: PlayerInfo[]): void;
  pushChat(m: ChatMessage): void;
  pushToast(text: string): void;
  addObject(o: WorldObject): void;
  toggleOwnerLabels(): void;
  setTier(t: QualityTier): void;
  setHotbar(i: number): void;
  toggleView(): void;

  setInRoom(v: boolean, roomId: string | null): void;
  setRoomPrompt(p: "enter" | "leave" | null): void;
  setOfficeState(agents: AgentInfo[], projects: ProjectInfo[], tasks: TaskInfo[], dialogues: DialogueLine[]): void;
  upsertAgent(a: AgentInfo): void;
  upsertProject(p: ProjectInfo): void;
  upsertTask(t: TaskInfo): void;
  setProgress(taskId: string, startedAt: number, endsAt: number): void;
  pushRoomDialogue(l: DialogueLine): void;
  toggleRoomPanel(): void;
  setNearAgent(a: { id: string; name: string } | null): void;
  setLastTalkAgent(a: { id: string; until: number }): void;
  setNearOwnAgent(a: { id: string; name: string } | null): void;
  setPossessAgent(a: { id: string; name: string } | null): void;
  removeAgent(id: string): void;
}

export const useWorld = create<WorldState>((set) => ({
  connected: false,
  joined: false,
  meta: null,
  selfId: "",
  selfName: "",
  auth: { user: null, token: null },
  settings: loadSettings(),
  players: [],
  chat: [],
  objects: [],
  toasts: [],
  showOwnerLabels: false,
  tier: "mid",
  hotbarIndex: 0,
  aiBusy: false,
  viewMode: "third",

  inRoom: false,
  roomId: null,
  roomPrompt: null,
  agents: [],
  projects: [],
  tasks: [],
  progress: {},
  roomDialogues: [],
  roomPanelOpen: false,
  nearAgent: null,
  lastTalkAgent: null,
  nearOwnAgent: null,
  possessAgent: null,

  setConnected: (v) => set({ connected: v }),
  setJoined: (name) => set({ joined: true, selfName: name }),
  setAuth: (user, token) => {
    if (token) localStorage.setItem("w3d_token", token);
    else localStorage.removeItem("w3d_token");
    set({ auth: { user, token } });
  },
  logout: () => {
    localStorage.removeItem("w3d_token");
    // 立刻离开世界：服务端清掉自己的化身，避免切账号后旧分身原地残留显示在线
    // （动态导入避免 store ↔ socket 循环依赖）
    void import("../net/socket").then((m) => m.sendLeave());
    set({ auth: { user: null, token: null }, joined: false });
  },
  setSettings: (patch) =>
    set((s) => {
      const next = { ...s.settings, ...patch };
      saveSettings(next);
      return { settings: next };
    }),
  setMeta: (m) => set({ meta: m }),
  setPlayers: (v) => set({ players: v }),
  pushChat: (m) => set((s) => ({ chat: [...s.chat.slice(-120), m] })),
  pushToast: (text) =>
    set((s) => {
      const t = { id: Date.now() + Math.random(), text };
      return { toasts: [...s.toasts.slice(-3), t] };
    }),
  addObject: (o) => set((s) => ({ objects: [...s.objects, o] })),
  toggleOwnerLabels: () => set((s) => ({ showOwnerLabels: !s.showOwnerLabels })),
  setTier: (t) => set({ tier: t }),
  setHotbar: (i) => set({ hotbarIndex: i }),
  toggleView: () => set((s) => ({ viewMode: s.viewMode === "third" ? "first" : "third" })),

  setInRoom: (v, roomId) => set({ inRoom: v, roomId, roomPrompt: null, roomPanelOpen: false }),
  setRoomPrompt: (p) => set({ roomPrompt: p }),
  setOfficeState: (agents, projects, tasks, dialogues) => set({ agents, projects, tasks, roomDialogues: dialogues, progress: {} }),
  upsertAgent: (a) => set((s) => ({ agents: s.agents.some((x) => x.id === a.id) ? s.agents.map((x) => (x.id === a.id ? a : x)) : [...s.agents, a] })),
  upsertProject: (p) => set((s) => ({ projects: s.projects.some((x) => x.id === p.id) ? s.projects.map((x) => (x.id === p.id ? p : x)) : [...s.projects, p] })),
  upsertTask: (t) => set((s) => ({ tasks: s.tasks.some((x) => x.id === t.id) ? s.tasks.map((x) => (x.id === t.id ? t : x)) : [...s.tasks, t] })),
  setProgress: (taskId, startedAt, endsAt) => set((s) => ({ progress: { ...s.progress, [taskId]: { startedAt, endsAt } } })),
  pushRoomDialogue: (l) => set((s) => ({ roomDialogues: [...s.roomDialogues.slice(-200), l] })),
  toggleRoomPanel: () => set((s) => ({ roomPanelOpen: !s.roomPanelOpen })),
  setNearAgent: (a) => set({ nearAgent: a }),
  setLastTalkAgent: (a) => set({ lastTalkAgent: a }),
  setNearOwnAgent: (a) => set({ nearOwnAgent: a }),
  setPossessAgent: (a) => set({ possessAgent: a, nearOwnAgent: null }),
  removeAgent: (id) =>
    set((s) => ({
      agents: s.agents.filter((x) => x.id !== id),
      nearAgent: s.nearAgent?.id === id ? null : s.nearAgent,
      nearOwnAgent: s.nearOwnAgent?.id === id ? null : s.nearOwnAgent,
      possessAgent: s.possessAgent?.id === id ? null : s.possessAgent,
    })),
}));
