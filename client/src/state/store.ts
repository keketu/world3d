import { create } from "zustand";
import { ChatMessage, PlayerInfo, WorldObject, WorldMeta } from "@world3d/shared";

export type QualityTier = "low" | "mid" | "high";

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
}));
