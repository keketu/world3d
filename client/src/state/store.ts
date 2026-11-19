import { create } from "zustand";
import { AgentInfo, ChatMessage, DialogueLine, PlayerInfo, ProjectInfo, TaskInfo, WorldMeta, WorldObject } from "@world3d/shared";

export type QualityTier = "low" | "mid" | "high";
export type ViewMode = "third" | "first";

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

  setConnected(v: boolean): void;
  setJoined(name: string): void;
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
}

export const useWorld = create<WorldState>((set) => ({
  connected: false,
  joined: false,
  meta: null,
  selfId: "",
  selfName: "",
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

  setConnected: (v) => set({ connected: v }),
  setJoined: (name) => set({ joined: true, selfName: name }),
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
}));
