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

/** 地表高度（不含水体）：中心草甸丘陵，r>90 向海缓降成岛，海边自然出现沙滩 */
export function heightAt(x: number, z: number, seed = WORLD_SEED): number {
  const n1 = valueNoise(x / 46, z / 46, seed); // 大起伏
  const n2 = valueNoise(x / 14, z / 14, seed ^ 0x9e37); // 细节
  const n3 = valueNoise(x / 5, z / 5, seed ^ 0x51f2); // 微起伏
  let h = 7 + n1 * 13 + n2 * 4.5 + n3 * 1.8;
  const d = Math.hypot(x - 128, z - 128);
  // 中心区域压平一点，方便新手盖楼
  if (d < 36) {
    const k = 1 - d / 36;
    h = h * (1 - k * 0.6) + 12 * (k * 0.6);
  }
  // 岛屿化：r>90 向海缓降（海岸线约 r≈98-108 随噪声摆动），r≥118 沉入海底
  if (d > 90) {
    const s = Math.min(1, (d - 90) / 28);
    h -= 24 * Math.pow(s, 1.55);
  }
  // 不取整：整数高度会在缓坡海岸形成 1m 台阶感
  return Math.max(2, Math.min(30, h));
}
