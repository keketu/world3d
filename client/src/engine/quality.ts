// 画质分级：自动探测 + 手动切换（集显可玩是硬约束）
import { QualityTier } from "../state/store";

export interface QualitySettings {
  tier: QualityTier;
  dpr: number; // 最终 devicePixelRatio（含渲染比例）
  fogNear: number;
  fogFar: number;
  /** 实时阴影贴图边长（0 = 关闭阴影） */
  shadowMap: number;
  /** 阴影覆盖半径（米，以玩家为中心） */
  shadowExtent: number;
  /** 环境居民数量（散步 NPC） */
  crowd: number;
}

export function detectTier(): QualityTier {
  const url = new URL(window.location.href);
  const forced = url.searchParams.get("tier");
  if (forced === "low" || forced === "mid" || forced === "high") return forced;
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4;
  if (cores >= 8 && mem >= 8) return "high";
  if (cores >= 4 && mem >= 4) return "mid";
  return "low";
}

export function qualityFor(tier: QualityTier): QualitySettings {
  switch (tier) {
    case "high":
      return { tier, dpr: Math.min(window.devicePixelRatio || 1, 2), fogNear: 140, fogFar: 480, shadowMap: 4096, shadowExtent: 100, crowd: 12 };
    case "mid":
      return { tier, dpr: Math.min(window.devicePixelRatio || 1, 1.25), fogNear: 100, fogFar: 340, shadowMap: 2048, shadowExtent: 80, crowd: 8 };
    case "low":
      return { tier, dpr: 0.75, fogNear: 45, fogFar: 190, shadowMap: 0, shadowExtent: 0, crowd: 4 };
  }
}

export function applyQuality(tier: QualityTier, renderer: { setPixelRatio: (v: number) => void }, fog: { near: number; far: number }): QualitySettings {
  const q = qualityFor(tier);
  renderer.setPixelRatio(q.dpr);
  fog.near = q.fogNear;
  fog.far = q.fogFar;
  return q;
}
