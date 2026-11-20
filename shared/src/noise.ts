// 确定性 value noise：两端（client 预览/server 权威）生成一致的地形高度
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x: number, z: number, seed: number): number {
  let h = (x * 374761393 + z * 668265263 + seed * 69069) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const a = hash2(xi, zi, seed);
  const b = hash2(xi + 1, zi, seed);
  const c = hash2(xi, zi + 1, seed);
  const d = hash2(xi + 1, zi + 1, seed);
  const u = smooth(xf);
  const v = smooth(zf);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

export const WORLD_SEED = 20261118;

/** 地表高度（不含水体）：开阔平原，缓丘起伏很小，全域高于水位（无海岸） */
export function heightAt(x: number, z: number, seed = WORLD_SEED): number {
  const n1 = valueNoise(x / 60, z / 60, seed); // 大尺度缓丘
  const n2 = valueNoise(x / 22, z / 22, seed ^ 0x9e37); // 细节
  const n3 = valueNoise(x / 8, z / 8, seed ^ 0x51f2); // 微起伏
  const h = 12.6 + (n1 - 0.5) * 2.4 + (n2 - 0.5) * 1.2 + (n3 - 0.5) * 0.5;
  // 钳制在 11.4 以上：水位 9、沙滩色阈值 11.2，全域保持草地平原
  return Math.max(11.4, Math.min(15, h));
}
