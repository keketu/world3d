// 画质分级：自动探测 + 手动切换（集显可玩是硬约束）
import { QualityTier } from "../state/store";

export interface QualitySettings {
  tier: QualityTier;
  dpr: number; // 最终 devicePixelRatio（含渲染比例）
  fogFar: number;
  viewChunks: number; // 视野区块半径
  interestRadius: number;
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
      return { tier, dpr: Math.min(window.devicePixelRatio || 1, 2), fogFar: 110, viewChunks: 5, interestRadius: 56 };
    case "mid":
      return { tier, dpr: Math.min(window.devicePixelRatio || 1, 1.25), fogFar: 80, viewChunks: 4, interestRadius: 48 };
    case "low":
      return { tier, dpr: 0.75, fogFar: 58, viewChunks: 3, interestRadius: 40 };
  }
}

export function applyQuality(tier: QualityTier, renderer: { setPixelRatio: (v: number) => void }, fog: { far: number }): QualitySettings {
  const q = qualityFor(tier);
  renderer.setPixelRatio(q.dpr);
  fog.far = q.fogFar;
  return q;
}
