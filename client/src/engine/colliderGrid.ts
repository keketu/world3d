// 碰撞体网格分桶：圆形（r>0）或朝向矩形（hw×hd，绕 y 轴 rotY），快速查询点/线段是否碰到
// 用于街景陈设（长椅/树/车/红绿灯…）：布局阶段查占位，运行时查行走阻挡
export interface Collider {
  x: number;
  z: number;
  /** 圆形半径；0 表示用矩形 */
  r: number;
  /** 矩形半宽（局部 x）/ 半深（局部 z） */
  hw: number;
  hd: number;
  rotY: number;
}

const CELL = 8;

/** 圆/矩形的包络半径 */
export function colliderRadius(c: Collider): number {
  return c.r > 0 ? c.r : Math.hypot(c.hw, c.hd);
}

export class ColliderGrid {
  private cells = new Map<number, Collider[]>();

  add(c: Collider) {
    const rad = colliderRadius(c);
    const x0 = Math.floor((c.x - rad) / CELL);
    const x1 = Math.floor((c.x + rad) / CELL);
    const z0 = Math.floor((c.z - rad) / CELL);
    const z1 = Math.floor((c.z + rad) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const key = cx * 4096 + cz;
        let arr = this.cells.get(key);
        if (!arr) {
          arr = [];
          this.cells.set(key, arr);
        }
        arr.push(c);
      }
    }
  }

  /** 点 (x,z) 外扩 margin 后是否碰到任何碰撞体 */
  hit(x: number, z: number, margin: number): boolean {
    const arr = this.cells.get(Math.floor(x / CELL) * 4096 + Math.floor(z / CELL));
    if (!arr) return false;
    for (const c of arr) {
      if (c.r > 0) {
        if (Math.hypot(c.x - x, c.z - z) < c.r + margin) return true;
      } else {
        // 世界 → 碰撞体局部：局部 +z 朝 (sin rotY, cos rotY)
        const dx = x - c.x;
        const dz = z - c.z;
        const co = Math.cos(c.rotY);
        const si = Math.sin(c.rotY);
        if (Math.abs(dx * co - dz * si) < c.hw + margin && Math.abs(dx * si + dz * co) < c.hd + margin) return true;
      }
    }
    return false;
  }

  /** 线段沿途每 0.5m 采样，整段都不碰才通过 */
  clearLine(x0: number, z0: number, x1: number, z1: number, margin: number): boolean {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.5));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (this.hit(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, margin)) return false;
    }
    return true;
  }

  /** 闭合折线（首尾相连）整圈都畅通 */
  clearLoop(pts: Array<[number, number]>, margin: number): boolean {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (!this.clearLine(a[0], a[1], b[0], b[1], margin)) return false;
    }
    return true;
  }
}
