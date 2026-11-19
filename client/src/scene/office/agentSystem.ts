// 角色系统：接收服务端订单（walk/sitAt/standUp/anim/face），
// 前端本地 A* 寻路 + 混合动画。状态放模块级 Map，每帧直写 ref，不触发 React 重渲染。
import {
  AgentInfo,
  AgentOrder,
  AnimOrder,
  FaceOrder,
  WalkOrder,
  SitOrder,
  StandOrder,
  EMPLOYEE_DESKS,
  EXTRA_DESKS,
  BOSS_SPOT,
  PM_SPOT,
} from "@world3d/shared";
import { findPath } from "./nav";

// 到达回报由 socket 层注入，避免模块循环引用
let arrivedEmitter: (ev: { agentId: string; orderId: string }) => void = () => {};
export function setArrivedEmitter(fn: typeof arrivedEmitter) {
  arrivedEmitter = fn;
}

export type CharAnim = "idle" | "walk" | "work" | "talk" | "sit";

export interface CharState {
  x: number;
  z: number;
  y: number;
  rotY: number;
  anim: CharAnim;
  seated: boolean;
}

const WALK_SPEED = 1.7; // m/s，与服务端预估一致
const SEAT_Y = 0.42;
const BLEND_SIT = 0.4;
const BLEND_STAND = 0.35;
const BLEND_FACE = 0.3;

interface Exec {
  order: AgentOrder;
  kind: "walk" | "sitBlend" | "standBlend" | "face";
  t: number;
  path?: Array<{ x: number; z: number }>;
  wpIndex?: number;
  fromX?: number;
  fromZ?: number;
  fromY?: number;
  fromRotY?: number;
  targetRotY?: number;
  faceAfter?: { x: number; z: number };
  sitTarget?: { x: number; z: number; rotY: number };
}

function angleTo(st: CharState, to: { x: number; z: number }) {
  return Math.atan2(to.x - st.x, to.z - st.z);
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function lerpAngle(a: number, b: number, t: number) {
  const d = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return a + d * t;
}
function smoothTurn(cur: number, target: number, k: number) {
  return lerpAngle(cur, target, Math.min(1, k));
}

const ALL_DESKS = [...EMPLOYEE_DESKS, ...EXTRA_DESKS, PM_SPOT, BOSS_SPOT];

function homeOf(a: AgentInfo) {
  if (a.deskId) {
    const d = ALL_DESKS.find((x) => x.id === a.deskId);
    if (d) return d;
  }
  if (a.role === "boss") return BOSS_SPOT;
  if (a.role === "pm") return PM_SPOT;
  return EMPLOYEE_DESKS.find((d) => d.id.endsWith(a.id)) ?? EMPLOYEE_DESKS[0];
}

class CharSystem {
  states = new Map<string, CharState>();
  infos = new Map<string, AgentInfo>();
  private queues = new Map<string, AgentOrder[]>();
  private execs = new Map<string, Exec>();

  hydrate(agents: AgentInfo[]) {
    for (const a of agents) {
      this.infos.set(a.id, a);
      if (!this.states.has(a.id)) {
        const home = homeOf(a);
        this.states.set(a.id, {
          x: home.seat.x,
          z: home.seat.z,
          y: SEAT_Y,
          rotY: home.seat.rotY,
          anim: "sit",
          seated: true,
        });
      }
    }
  }

  push(order: AgentOrder) {
    const q = this.queues.get(order.agentId) ?? [];
    q.push(order);
    this.queues.set(order.agentId, q);
  }

  /** 附身接管：清空该 agent 的待办订单，位置动画由操控方直写 */
  takeover(agentId: string) {
    this.queues.delete(agentId);
    this.execs.delete(agentId);
    const st = this.states.get(agentId);
    if (st) {
      st.seated = false;
      st.y = 0;
      st.anim = "idle";
    }
  }

  /** 移除 agent（解雇离场） */
  drop(agentId: string) {
    this.queues.delete(agentId);
    this.execs.delete(agentId);
    this.states.delete(agentId);
    this.infos.delete(agentId);
  }

  update(dt: number) {
    for (const [agentId, q] of this.queues) {
      if (q.length === 0) continue;
      const st = this.states.get(agentId);
      if (!st) continue;
      let exec = this.execs.get(agentId);
      if (!exec) {
        const order = q.shift()!;
        exec = this.begin(st, order) ?? undefined;
        if (!exec) {
          // begin 返回 null 表示立即完成（如 anim/face 直接生效）
          this.finish(st, order);
          arrivedEmitter({ agentId, orderId: order.orderId });
          continue;
        }
        this.execs.set(agentId, exec);
      }
      if (this.step(st, exec, dt)) {
        this.execs.delete(agentId);
        this.finish(st, exec.order);
        arrivedEmitter({ agentId, orderId: exec.order.orderId });
      }
    }
  }

  private finish(st: CharState, order: AgentOrder) {
    if (order.type === "anim") {
      const anim = (order as AnimOrder).anim;
      st.anim = anim === "type" ? "work" : anim === "sit" ? "sit" : (anim as CharAnim);
    }
  }

  private begin(st: CharState, order: AgentOrder): Exec | null {
    switch (order.type) {
      case "anim":
        return null; // finish() 里处理
      case "face": {
        st.rotY = angleTo(st, (order as FaceOrder).to);
        return null;
      }
      case "walk": {
        const w = order as WalkOrder;
        const path = findPath(st.x, st.z, w.x, w.z);
        if (st.seated) st.y = 0;
        st.seated = false;
        st.anim = "walk";
        return { order, kind: "walk", t: 0, path, wpIndex: 0, faceAfter: w.faceTo };
      }
      case "sitAt": {
        const s = order as SitOrder;
        const near = Math.hypot(st.x - s.x, st.z - s.z) < 0.2;
        if (near) {
          st.seated = true;
          return {
            order,
            kind: "sitBlend",
            t: 0,
            fromX: st.x,
            fromZ: st.z,
            fromY: st.y,
            targetRotY: s.rotY,
            sitTarget: { x: s.x, z: s.z, rotY: s.rotY },
          };
        }
        // 较远：先走到座位，再落座
        const path = findPath(st.x, st.z, s.x, s.z);
        if (st.seated) st.y = 0;
        st.seated = false;
        st.anim = "walk";
        return { order, kind: "walk", t: 0, path, wpIndex: 0, sitTarget: { x: s.x, z: s.z, rotY: s.rotY } };
      }
      case "standUp": {
        const o = order as StandOrder;
        if (!st.seated) {
          st.y = 0;
          st.seated = false;
          if (o.faceTo) {
            return {
              order,
              kind: "face",
              t: 0,
              fromRotY: st.rotY,
              targetRotY: angleTo(st, o.faceTo),
            };
          }
          return null;
        }
        st.seated = false;
        return {
          order,
          kind: "standBlend",
          t: 0,
          fromY: st.y,
          fromRotY: st.rotY,
          targetRotY: o.faceTo ? angleTo(st, o.faceTo) : undefined,
        };
      }
    }
  }

  private step(st: CharState, exec: Exec, dt: number): boolean {
    switch (exec.kind) {
      case "walk": {
        const path = exec.path!;
        let remain = WALK_SPEED * dt;
        while (remain > 0 && exec.wpIndex! < path.length) {
          const wp = path[exec.wpIndex!];
          const dx = wp.x - st.x;
          const dz = wp.z - st.z;
          const d = Math.hypot(dx, dz);
          if (d <= remain) {
            st.x = wp.x;
            st.z = wp.z;
            remain -= d;
            exec.wpIndex!++;
          } else {
            st.x += (dx / d) * remain;
            st.z += (dz / d) * remain;
            st.rotY = smoothTurn(st.rotY, Math.atan2(dx, dz), dt * 10);
            remain = 0;
          }
        }
        if (exec.wpIndex! < path.length) return false;
        if (exec.sitTarget) {
          exec.kind = "sitBlend";
          exec.t = 0;
          exec.fromX = st.x;
          exec.fromZ = st.z;
          exec.fromY = 0;
          return false;
        }
        if (exec.faceAfter) {
          exec.kind = "face";
          exec.t = 0;
          exec.fromRotY = st.rotY;
          exec.targetRotY = angleTo(st, exec.faceAfter);
          st.anim = "idle";
          return false;
        }
        return true;
      }
      case "sitBlend": {
        exec.t += dt;
        const k = Math.min(1, exec.t / BLEND_SIT);
        if (exec.sitTarget) {
          st.x = lerp(exec.fromX!, exec.sitTarget.x, k);
          st.z = lerp(exec.fromZ!, exec.sitTarget.z, k);
          st.rotY = smoothTurn(st.rotY, exec.sitTarget.rotY, dt * 9);
        }
        st.y = lerp(exec.fromY ?? 0, SEAT_Y, k);
        st.anim = k > 0.55 ? "sit" : "walk";
        if (k >= 1) {
          st.seated = true;
          st.anim = "sit";
          return true;
        }
        return false;
      }
      case "standBlend": {
        exec.t += dt;
        const k = Math.min(1, exec.t / BLEND_STAND);
        st.y = lerp(exec.fromY ?? SEAT_Y, 0, k);
        st.anim = "idle";
        if (k >= 1) {
          if (exec.targetRotY !== undefined) {
            exec.kind = "face";
            exec.t = 0;
            exec.fromRotY = st.rotY;
            return false;
          }
          return true;
        }
        return false;
      }
      case "face": {
        exec.t += dt;
        const k = Math.min(1, exec.t / BLEND_FACE);
        st.rotY = lerpAngle(exec.fromRotY ?? st.rotY, exec.targetRotY ?? st.rotY, k);
        return k >= 1;
      }
    }
  }
}

export const charSystem = new CharSystem();
