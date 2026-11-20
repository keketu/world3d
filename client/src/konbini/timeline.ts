// 组装动画时间线：底座→地面→墙体→内饰亮灯→屋顶→街景散件→霓虹→下雨
// 每个元素记录初始位置与动画参数，由 Timeline.update(t) 统一驱动
import * as THREE from "three";

type CueKind = "rise" | "drop" | "pop" | "spin" | "growY";

interface Cue {
  obj: THREE.Object3D;
  kind: CueKind;
  delay: number;
  dur: number;
  amount: number;
  /** rise/drop 的最终 y；pop 最终 scale=1；spin 最终 rotY */
  finalY: number;
  finalRotY: number;
}

const easeOutCubic = (p: number) => 1 - Math.pow(1 - p, 3);
const easeOutBack = (p: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
};

export class Timeline {
  private cues: Cue[] = [];
  private born = performance.now();
  /** 尚未到 delay 的元素先隐藏（避免未入场的元素提前可见） */
  private hidden = new Set<THREE.Object3D>();

  /** 登记入场动画（记录最终状态，立即应用到起始帧） */
  add(obj: THREE.Object3D, kind: CueKind, delay: number, dur: number, amount = 3) {
    const cue: Cue = {
      obj,
      kind,
      delay,
      dur,
      amount,
      finalY: obj.position.y,
      finalRotY: obj.rotation.y,
    };
    this.cues.push(cue);
    this.applyAt(cue, -0.001);
    this.hidden.add(obj);
  }

  /** 重播（双击画布） */
  restart() {
    this.born = performance.now();
    for (const c of this.cues) this.applyAt(c, -0.001);
  }

  /** 当前时间（秒） */
  get t(): number {
    return (performance.now() - this.born) / 1000;
  }

  private applyAt(c: Cue, t: number) {
    const p = Math.min(1, Math.max(0, (t - c.delay) / c.dur));
    const e = easeOutCubic(p);
    switch (c.kind) {
      case "rise":
        c.obj.position.y = c.finalY - (1 - e) * c.amount;
        break;
      case "drop":
        c.obj.position.y = c.finalY + (1 - e) * c.amount;
        break;
      case "pop": {
        const s = p <= 0 ? 0.001 : Math.max(0.001, easeOutBack(p));
        c.obj.scale.setScalar(s);
        break;
      }
      case "spin":
        c.obj.rotation.y = c.finalRotY + (1 - easeOutBack(p)) * Math.PI * 1.5;
        break;
      case "growY":
        c.obj.scale.y = p <= 0 ? 0.001 : Math.max(0.001, e);
        break;
    }
    // 未到时间的元素先藏起来
    const notYet = t < c.delay;
    if (notYet) c.obj.visible = false;
    else if (this.hidden.has(c.obj)) {
      c.obj.visible = true;
      this.hidden.delete(c.obj);
    }
  }

  /** 每帧驱动 */
  update() {
    const t = this.t;
    for (const c of this.cues) this.applyAt(c, t);
  }
}
